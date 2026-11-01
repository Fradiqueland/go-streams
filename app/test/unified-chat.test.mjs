import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Store,Vault,Studio} from '../src/core.mjs';
import {UnifiedChat} from '../src/unified-chat.mjs';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';

const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture(t,request){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'chat-test-'));
 const store=new Store(root),studio=new Studio(store,new Vault(root,{portable:true})),sockets=[];
 const chat=new UnifiedChat(studio,{base:'http://127.0.0.1:4317',request,socketFactory:url=>{const socket=new EventTarget();socket.url=url;socket.closeCount=0;socket.close=()=>{socket.closeCount++;socket.dispatchEvent(new Event('close'));};sockets.push(socket);return socket;}});
 t.after(async()=>{await chat.shutdown();await studio.shutdown();assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return {root,studio,chat,sockets};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('Google desktop OAuth uses PKCE and one-time state; credentials are encrypted and excluded from chat state',async t=>{
 const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return response(url.includes('/token')?{access_token:'PRIVATE-ACCESS',refresh_token:'PRIVATE-REFRESH',expires_in:3600}:{items:[{id:'owner',snippet:{title:'Presenter'}}]});});
 f.chat.auth.configure('YouTube',{clientId:'123-test.apps.googleusercontent.com',clientSecret:'PRIVATE-CLIENT-SECRET'});
 const info=await f.chat.auth.begin('YouTube'),url=new URL(info.YouTube.pending.url);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'));
 await assert.rejects(f.chat.auth.callback(new URLSearchParams({state:'wrong',code:'code'})),/state/);assert.equal(calls.length,0);
 const params=new URLSearchParams({state:url.searchParams.get('state'),code:'code'});await f.chat.auth.callback(params);
 assert.equal(f.chat.state().accounts.YouTube.name,'Presenter');assert.ok(new URLSearchParams(calls[0].options.body).get('code_verifier'));
 const disk=fs.readFileSync(f.chat.auth.file,'utf8'),state=JSON.stringify(f.chat.state());for(const secret of ['PRIVATE-ACCESS','PRIVATE-REFRESH','PRIVATE-CLIENT-SECRET']){assert.ok(!disk.includes(secret));assert.ok(!state.includes(secret));}
 await assert.rejects(f.chat.auth.callback(params),/expired/);
});
test('YouTube chat merges messages, respects polling interval, sends only to its origin, and deduplicates retries and echoes',async t=>{
 let sent=0;const requests=[];
 const f=fixture(t,async(url,options)=>{requests.push({url,options});if(url.includes('/videos?'))return response({items:[{liveStreamingDetails:{activeLiveChatId:'room'}}]});if(options.method==='POST'){sent++;return response({id:'sent-id'});}return response({pollingIntervalMillis:12345,nextPageToken:'next',items:[{id:'viewer-id',authorDetails:{displayName:'<Viewer>',channelId:'viewer'},snippet:{displayMessage:'<script>hello</script>',publishedAt:'2026-10-31T20:00:00Z'}}]});});
 f.chat.auth.data.accounts.YouTube={id:'owner',name:'Presenter',accessToken:'SECRET',expires:Date.now()+3600000};
 const id=f.studio.saveChannel({name:'YouTube live',platform:'YouTube',url:'rtmp://127.0.0.1:9/live',key:'stream-key'});
 await f.chat.connect({channelId:id,resource:'abcdefghijk',confirmed:true});const c=f.chat.connections.get(id);
 assert.equal(c.status,'connected');assert.equal(c.pollingIntervalMillis,12345);assert.equal(f.chat.messages.length,1);
 const input={connectionId:id,text:'Thanks!',replyTo:f.chat.messages[0].id,confirmed:true,requestId:crypto.randomUUID()};
 const [a,b]=await Promise.all([f.chat.send(input),f.chat.send(input)]);assert.deepEqual(a,b);assert.equal(sent,1);
 const body=JSON.parse(requests.find(r=>r.options.method==='POST').options.body);assert.equal(body.snippet.textMessageDetails.messageText,'@<Viewer> Thanks!');assert.equal(body.snippet.liveChatId,'room');
 f.chat.add(c,{remoteId:'sent-id',author:'Presenter',text:'echo'});assert.equal(f.chat.messages.length,2);
 await assert.rejects(f.chat.send({...input,text:'Different'}),/reused/);
 const parent=f.chat.messages[0];parent.connectionId='other';await assert.rejects(f.chat.send({...input,requestId:crypto.randomUUID()}),/no longer/);
 parent.connectionId=id;const oldMessageId=parent.id;await f.chat.connect({channelId:id,resource:'https://www.youtube.com/live/abcdefghijk',confirmed:true});assert.ok(!f.chat.messages.some(m=>m.id===oldMessageId));
});
test('Twitch chat subscribes with the authorized sender and supports threaded responses; rejected sends are not reported delivered',async t=>{
 const requests=[];let deliver=true;
 const f=fixture(t,async(url,options)=>{requests.push({url,options});if(url.includes('users?'))return response({data:[{id:'broadcaster'}]});if(url.includes('subscriptions'))return response({data:[{id:'subscription',status:'enabled'}]},202);return response({data:[{is_sent:deliver,message_id:'reply-id'}]});});
 f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};f.chat.auth.data.accounts.Twitch={id:'presenter',name:'Host',accessToken:'PRIVATE',expires:Date.now()+3600000,validated:Date.now()};
 const id=f.studio.saveChannel({name:'Twitch',platform:'Twitch',url:'rtmp://127.0.0.1:9/live',key:'stream'});await f.chat.connect({channelId:id,resource:'my_channel',confirmed:true});
 const socket=f.sockets[0],message=value=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));
 message({metadata:{message_type:'session_welcome'},payload:{session:{id:'session',keepalive_timeout_seconds:10}}});await turn();
 assert.equal(f.chat.connections.get(id).status,'connected');assert.equal(JSON.parse(requests[1].options.body).condition.user_id,'presenter');
 message({metadata:{message_type:'notification',message_timestamp:'2026-10-31T20:00:00Z'},payload:{subscription:{type:'channel.chat.message'},event:{broadcaster_user_id:'broadcaster',chatter_user_id:'viewer',chatter_user_name:'Viewer',message_id:'parent',message:{text:'Hello'}}}});await turn();
 const input={connectionId:id,text:'Hello back',replyTo:f.chat.messages[0].id,requestId:crypto.randomUUID(),confirmed:true};await f.chat.send(input);
 assert.equal(JSON.parse(requests.at(-1).options.body).reply_parent_message_id,'parent');
 deliver=false;f.chat.connections.get(id).lastSent=0;await assert.rejects(f.chat.send({...input,requestId:crypto.randomUUID()}),/did not send/);assert.equal(f.chat.messages.length,2);
});
test('chat limits retained messages, rejects missing consent and unsupported providers, and discards late data after disconnect',async t=>{
 const f=fixture(t,async()=>response({}));const id=f.studio.saveChannel({name:'Other',platform:'Facebook',url:'rtmp://127.0.0.1:9/live',key:'stream'});
 await assert.rejects(f.chat.connect({channelId:id,resource:'abc',confirmed:true}),/currently available/);
 const c={id:'c',status:'connected',platform:'YouTube'};f.chat.connections.set(c.id,c);for(let i=0;i<600;i++)f.chat.add(c,{remoteId:String(i),text:'message'});assert.equal(f.chat.messages.length,500);assert.equal(f.chat.seen.size,500);
 await assert.rejects(f.chat.send({connectionId:'c',text:'No consent'}),/Confirm/);f.chat.disconnect('c');f.chat.add(c,{remoteId:'late',text:'late'});assert.equal(f.chat.messages.length,500);
});
test('disconnect during account validation cannot restore a revoked local account',async t=>{
 let release;const hold=new Promise(resolve=>{release=resolve;});const f=fixture(t,async()=>{await hold;return response({items:[{id:'owner',snippet:{title:'Presenter'}}]});});
 const accepting=f.chat.auth.accept('YouTube',{access_token:'secret',expires_in:3600});try{f.chat.auth.disconnect('YouTube');}finally{release();}await assert.rejects(accepting,/cancelled/);assert.equal(f.chat.state().accounts.YouTube.authorized,false);
});
test('chat routes require the local authenticated session and CSRF header; no OAuth secrets are returned',async t=>{
 const f=fixture(t,async()=>response({})),app=await createApplication({directory:path.join(f.root,'api'),clock:false,listen:false,portableVault:true,chatOptions:{request:async()=>response({})}});t.after(()=>app.close());
 assert.equal((await dispatch(app,'/api/chat')).status,401);
 const headers={Cookie:'go_streams='+app.token,'Content-Type':'application/json'};
 assert.equal((await dispatch(app,'/api/chat/settings',{method:'PUT',headers,body:'{}'})).status,403);
 assert.equal((await dispatch(app,'/api/chat',{headers})).status,200);
 assert.equal((await dispatch(app,'/oauth/youtube?state=wrong&code=code')).status,403);
});
test('Twitch public device authorization and refresh serialize rotating tokens without a client secret',async t=>{
 let refreshes=0;const calls=[];
 const f=fixture(t,async(url,options)=>{calls.push({url,options});if(url.endsWith('/device'))return response({device_code:'private-device',user_code:'PUBLIC-CODE',verification_uri:'https://www.twitch.tv/activate?public=true',interval:5,expires_in:600});if(url.endsWith('/validate'))return response({client_id:'abcdefgh123',user_id:'host',login:'Presenter',scopes:['user:read:chat','user:write:chat']});const form=new URLSearchParams(options.body);if(form.get('grant_type')==='refresh_token')refreshes++;return response({access_token:'private-access',refresh_token:'rotated-'+refreshes,expires_in:3600});});
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});await f.chat.auth.begin('Twitch');const pending=f.chat.auth.pending.get('Twitch');assert.equal(f.chat.state().accounts.Twitch.pending.code,'PUBLIC-CODE');assert.ok(!JSON.stringify(f.chat.state()).includes('private-device'));
 clearTimeout(pending.timer);await f.chat.auth.pollDevice(pending);assert.equal(f.chat.state().accounts.Twitch.authorized,true);
 f.chat.auth.data.accounts.Twitch.expires=0;await Promise.all([f.chat.auth.token('Twitch'),f.chat.auth.token('Twitch')]);assert.equal(refreshes,1);assert.equal(f.chat.auth.data.accounts.Twitch.refreshToken,'rotated-1');assert.ok(calls.every(c=>!new URLSearchParams(c.options.body||'').has('client_secret')));
 await assert.rejects(f.chat.auth.http('https://evil.test/token'),/rejected/);
});

test('a stale Twitch device callback cannot cancel a newer authorization',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return response({device_code:'device-'+calls,user_code:'CODE',verification_uri:'https://www.twitch.tv/activate',expires_in:600});});
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});await f.chat.auth.begin('Twitch');const previous=f.chat.auth.pending.get('Twitch');
 await f.chat.auth.begin('Twitch');const current=f.chat.auth.pending.get('Twitch');
 await f.chat.auth.pollDevice(previous);assert.equal(f.chat.auth.pending.get('Twitch'),current);assert.equal(calls,2);
});

test('changing a Google application does not reuse the previous application secret',t=>{
 const f=fixture(t,async()=>response({}));f.chat.auth.configure('YouTube',{clientId:'123-first.apps.googleusercontent.com',clientSecret:'first-secret'});
 f.chat.auth.configure('YouTube',{clientId:'123-second.apps.googleusercontent.com'});assert.equal(f.chat.auth.data.settings.YouTube.clientSecret,'');
});

test('authorizing a different channel never retains the old channel refresh token',async t=>{
 const f=fixture(t,async()=>response({items:[{id:'new-owner',snippet:{title:'New presenter'}}]}));
 f.chat.auth.data.accounts.YouTube={id:'old-owner',name:'Old',accessToken:'old-access',refreshToken:'old-refresh'};
 await f.chat.auth.accept('YouTube',{access_token:'new-access',expires_in:3600});assert.equal(f.chat.auth.data.accounts.YouTube.refreshToken,'');
});

test('a reply waiting for credentials cannot post after its chat was disconnected',async t=>{
 let posts=0;const f=fixture(t,async()=>{posts++;return response({id:'sent'});});
 const c={id:'chat',chatId:'room',platform:'YouTube',status:'connected'};f.chat.connections.set(c.id,c);
 const account={id:'owner',name:'Host',accessToken:'private'};f.chat.auth.token=async()=>account;
 const sending=f.chat.send({connectionId:c.id,text:'Do not send to a stale room',requestId:crypto.randomUUID(),confirmed:true});f.chat.disconnect(c.id);
 await assert.rejects(sending,/disconnected|changed/);assert.equal(posts,0);
});

test('reply destination is checked again after API credential lookup',async t=>{
 let posts=0,lookups=0;const f=fixture(t,async()=>{posts++;return response({id:'sent'});});
 const c={id:'chat',chatId:'room',platform:'YouTube',status:'connected'};f.chat.connections.set(c.id,c);
 f.chat.auth.token=async()=>{if(++lookups===2)f.chat.disconnect(c.id);return {id:'owner',name:'Host',accessToken:'private'};};
 await assert.rejects(f.chat.send({connectionId:c.id,text:'Stale destination',requestId:crypto.randomUUID(),confirmed:true}),/disconnected|changed/);assert.equal(lookups,2);assert.equal(posts,0);
});

test('Twitch reconnect retains old-socket events until welcome and closes every socket on disconnect',async t=>{
 let subscriptions=0;const f=fixture(t,async(url)=>{if(url.includes('users?'))return response({data:[{id:'broadcaster'}]});subscriptions++;return response({data:[{id:'subscription',status:'enabled'}]},202);});
 f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'private',expires:Date.now()+3600000,validated:Date.now()};
 const id=f.studio.saveChannel({name:'Twitch',platform:'Twitch',url:'rtmp://127.0.0.1:9/live',key:'key'});await f.chat.connect({channelId:id,resource:'host_channel',confirmed:true});
 const emit=(socket,type,payload)=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({metadata:{message_type:type},payload})}));
 const first=f.sockets[0];emit(first,'session_welcome',{session:{id:'first',keepalive_timeout_seconds:60}});await turn();
 emit(first,'session_reconnect',{session:{reconnect_url:'wss://eventsub.wss.twitch.tv/ws?reconnect=one'}});await turn();const second=f.sockets[1];
 emit(first,'notification',{subscription:{type:'channel.chat.message'},event:{broadcaster_user_id:'broadcaster',chatter_user_name:'Viewer',message_id:'during-handoff',message:{text:'Preserve this message'}}});await turn();
 assert.equal(f.chat.messages.length,1);assert.equal(first.closeCount,0);
 emit(second,'session_welcome',{session:{id:'second',keepalive_timeout_seconds:60}});await turn();assert.equal(first.closeCount,1);assert.equal(subscriptions,1);assert.equal(f.chat.connections.get(id).status,'connected');
 emit(second,'session_reconnect',{session:{reconnect_url:'wss://eventsub.wss.twitch.tv/ws?reconnect=two'}});await turn();const third=f.sockets[2];
 assert.doesNotThrow(()=>JSON.stringify(f.chat.state()));f.chat.disconnect(id);assert.equal(second.closeCount,1);assert.equal(third.closeCount,1);
 emit(second,'notification',{subscription:{type:'channel.chat.message'},event:{broadcaster_user_id:'broadcaster',message_id:'late',message:{text:'Discard'}}});await turn();assert.equal(f.chat.messages.length,1);
});

test('Twitch honors a negotiated keepalive window throughout reconnects',async t=>{
 const f=fixture(t,async(url)=>response(url.includes('users?')?{data:[{id:'broadcaster'}]}:{data:[{id:'subscription',status:'enabled'}]},url.includes('users?')?200:202));
 f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'private',expires:Date.now()+3600000,validated:Date.now()};
 t.mock.timers.enable({apis:['setTimeout']});
 const id=f.studio.saveChannel({name:'Twitch',platform:'Twitch',url:'rtmp://127.0.0.1:9/live',key:'key'});await f.chat.connect({channelId:id,resource:'host_channel',confirmed:true});
 const emit=(socket,type,payload)=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({metadata:{message_type:type},payload})}));
 const first=f.sockets[0];emit(first,'session_welcome',{session:{id:'first',keepalive_timeout_seconds:60}});await turn();emit(first,'session_keepalive',{});await turn();
 t.mock.timers.tick(26000);assert.equal(f.chat.connections.get(id).status,'connected');
 emit(first,'session_reconnect',{session:{reconnect_url:'wss://eventsub.wss.twitch.tv/ws?reconnect=one'}});await turn();const second=f.sockets[1];emit(second,'session_welcome',{session:{id:'second',keepalive_timeout_seconds:null}});await turn();
 t.mock.timers.tick(26000);assert.equal(f.chat.connections.get(id).status,'connected');t.mock.timers.tick(40000);assert.equal(f.chat.connections.get(id).status,'error');assert.equal(second.closeCount,1);
});

test('chat HTTP requests prohibit redirects and reject malformed or oversized provider responses',async t=>{
 let mode='invalid';const f=fixture(t,async(url,options)=>{assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);return mode==='invalid'?new Response('<html>gateway failure</html>'):response({data:'x'.repeat(1024*1024)});});
 await assert.rejects(f.chat.auth.http('https://api.twitch.tv/helix/users'),/Invalid chat service response/);mode='large';await assert.rejects(f.chat.auth.http('https://api.twitch.tv/helix/users'),/too large/);
});

test('destination edits retain compatible chat and refresh names; deletion and platform changes clear obsolete chat',t=>{
 const f=fixture(t,async()=>response({}));
 const id=f.studio.saveChannel({name:'Original',platform:'YouTube',url:'rtmp://127.0.0.1:9/live',key:'stream'});
 const c={id,channelId:id,name:'Original',platform:'YouTube',chatId:'room',status:'connected'};f.chat.connections.set(id,c);f.chat.add(c,{remoteId:'first',text:'Hello'});
 f.studio.store.data.channels.find(item=>item.id===id).name='Renamed';f.chat.syncChannel(id);assert.equal(f.chat.connections.get(id),c);assert.equal(c.name,'Renamed');assert.equal(f.chat.messages[0].channelName,'Renamed');
 f.studio.store.data.channels.find(item=>item.id===id).platform='Twitch';f.chat.syncChannel(id);assert.equal(f.chat.connections.has(id),false);assert.equal(f.chat.messages.length,0);assert.equal(f.chat.seen.size,0);
 const second={...c,platform:'Twitch',status:'connected'};f.chat.connections.set(id,second);f.chat.add(second,{remoteId:'second',text:'New room'});f.chat.disconnect(id);f.studio.store.data.channels.find(item=>item.id===id).platform='YouTube';f.chat.syncChannel(id);assert.equal(f.chat.messages.length,0);
 const third={...c,status:'connected'};f.chat.connections.set(id,third);f.chat.add(third,{remoteId:'third',text:'Final room'});f.studio.store.data.channels=[];f.chat.syncChannel(id);assert.equal(f.chat.connections.has(id),false);assert.equal(f.chat.messages.length,0);assert.equal(f.chat.seen.size,0);
});

test('a pending reply cannot switch account authorization while retaining the same room',async t=>{
 let posts=0,lookups=0;const f=fixture(t,async()=>{posts++;return response({id:'sent'});});
 const c={id:'chat',chatId:'room',platform:'YouTube',status:'connected'};f.chat.connections.set(c.id,c);
 f.chat.auth.token=async()=>{if(++lookups===2)f.chat.auth.versions.YouTube++;return {id:lookups===1?'old-owner':'new-owner',name:'Host',accessToken:'private'};};
 await assert.rejects(f.chat.send({connectionId:c.id,text:'Confirmed under the old authorization',requestId:crypto.randomUUID(),confirmed:true}),/authorization|account|changed/);
 assert.equal(posts,0);assert.equal(c.sending,false);
});

test('malformed platform acknowledgements never become a confirmed outgoing message',async t=>{
 let value;const f=fixture(t,async()=>response(value));
 f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};
 f.chat.auth.token=async()=>({id:'host',name:'Host',accessToken:'private'});
 for(const [platform,payload]of [['YouTube',{id:123}],['Twitch',{data:[{is_sent:'false',message_id:'message'}]}],['Twitch',{data:[{is_sent:true,message_id:{invalid:true}}]}]]){
  value=payload;const c={id:'chat',chatId:'room',broadcasterId:'broadcaster',platform,status:'connected'};f.chat.connections.set(c.id,c);
  await assert.rejects(f.chat.send({connectionId:c.id,text:'Require a valid acknowledgement',requestId:crypto.randomUUID(),confirmed:true}),/did not send|confirm delivery/);
  assert.equal(f.chat.messages.length,0);assert.equal(c.lastSent,undefined);
 }
});

test('an invalid YouTube polling interval cannot overflow a timer into rapid requests',async t=>{
 const f=fixture(t,async url=>response(url.includes('/videos?')?{items:[{liveStreamingDetails:{activeLiveChatId:'room'}}]}:{items:[],pollingIntervalMillis:'Infinity'}));
 f.chat.auth.token=async()=>({id:'host',name:'Host',accessToken:'private'});
 const id=f.studio.saveChannel({name:'YouTube',platform:'YouTube',url:'rtmp://localhost/live',key:'stream'});
 await assert.rejects(f.chat.connect({channelId:id,resource:'abcdefghijk',confirmed:true}),/polling|response/);const c=f.chat.connections.get(id);
 assert.equal(c.status,'error');assert.match(c.error,/polling|response/);assert.equal(c.timer,undefined);
});

test('Twitch does not report a chat connected without an enabled subscription acknowledgement',async t=>{
 const f=fixture(t,async url=>response(url.includes('users?')?{data:[{id:'broadcaster'}]}:{data:[]},url.includes('users?')?200:202));
 f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};
 f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'private',expires:Date.now()+3600000,validated:Date.now()};
 const id=f.studio.saveChannel({name:'Twitch',platform:'Twitch',url:'rtmp://localhost/live',key:'stream'});
 await f.chat.connect({channelId:id,resource:'host_channel',confirmed:true});const socket=f.sockets[0];
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({metadata:{message_type:'session_welcome'},payload:{session:{id:'session',keepalive_timeout_seconds:60}}})}));await turn();
 assert.equal(f.chat.connections.get(id).status,'error');assert.equal(socket.closeCount,1);
});

test('invalid Twitch device timing cannot overflow timers or expose a credential-bearing activation URL',async t=>{
 let overrides;const f=fixture(t,async()=>response({device_code:'device',user_code:'CODE',verification_uri:'https://www.twitch.tv/activate',interval:5,expires_in:600,...overrides}));
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});
 for(overrides of [{interval:1e30},{expires_in:-1},{verification_uri:'https://unexpected:credentials@www.twitch.tv/activate'}]){
  await assert.rejects(f.chat.auth.begin('Twitch'),/response|timing|address/);
  assert.equal(f.chat.auth.pending.has('Twitch'),false);
 }
});

test('invalid token lifetimes and refresh token types are rejected before account validation',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return response({items:[{id:'owner',snippet:{title:'Host'}}]});});
 for(const extra of [{expires_in:1e30},{expires_in:-1},{refresh_token:{invalid:true}}]){
  await assert.rejects(f.chat.auth.accept('YouTube',{access_token:'access',...extra}),/token|lifetime|response/);
  assert.equal(f.chat.auth.data.accounts.YouTube,undefined);
 }
 assert.equal(calls,0);
});

test('chat response objects and message IDs are validated before entering retained state',async t=>{
 let value;const f=fixture(t,async()=>response(value));
 for(value of [null,[],false,42,'unexpected'])await assert.rejects(f.chat.auth.http('https://api.twitch.tv/helix/users'),/Invalid chat service response/);
 const c={id:'chat',platform:'YouTube',status:'connected'};f.chat.connections.set(c.id,c);
 for(const remoteId of [null,{},42,'','x'.repeat(1001)])f.chat.add(c,{remoteId,text:'Invalid ID'});
 assert.equal(f.chat.messages.length,0);assert.equal(f.chat.seen.size,0);
});

test('hourly Twitch validation still works when an optional refresh token is absent',async t=>{
 const f=fixture(t,async()=>response({client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:['user:read:chat','user:write:chat']}));
 f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};
 f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'private',expires:Date.now()+7200000,validated:0};
 const account=await f.chat.auth.token('Twitch');assert.equal(account.id,'host');assert.equal(account.refreshToken,'');assert.ok(account.validated>0);
});

test('disconnected provider lookups reject stale connect completions instead of reporting success',async t=>{
 for(const platform of ['YouTube','Twitch']){
  let release,calls=0;const hold=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,async()=>{calls++;await hold;return response(platform==='YouTube'?{items:[{liveStreamingDetails:{activeLiveChatId:'room'}}]}:{data:[{id:'broadcaster'}]});});
  f.chat.auth.token=async()=>({id:'host',name:'Host',accessToken:'private'});f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};
  const id=f.studio.saveChannel({name:platform,platform,url:'rtmp://localhost/live',key:'stream'});
  const connecting=f.chat.connect({channelId:id,resource:platform==='YouTube'?'abcdefghijk':'host_channel',confirmed:true});await turn();f.chat.disconnect(id);release();
  await assert.rejects(connecting,error=>error.status===409);assert.equal(f.chat.connections.has(id),false);assert.equal(calls,1);assert.equal(f.sockets.length,0);
 }
});

test('an old provider lookup cannot report success over a replacement room',async t=>{
 let release,reads=0;const hold=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,async url=>{if(url.includes('/videos?')){const read=++reads;if(read===1)await hold;return response({items:[{liveStreamingDetails:{activeLiveChatId:read===1?'old-room':'new-room'}}]});}return response({items:[],pollingIntervalMillis:30000});});
 f.chat.auth.token=async()=>({id:'host',name:'Host',accessToken:'private'});
 const id=f.studio.saveChannel({name:'YouTube',platform:'YouTube',url:'rtmp://localhost/live',key:'stream'});
 const old=f.chat.connect({channelId:id,resource:'abcdefghijk',confirmed:true});await turn();
 await f.chat.connect({channelId:id,resource:'ZYXWVUTSRQP',confirmed:true});const current=f.chat.connections.get(id);release();
 await assert.rejects(old,error=>error.status===409);assert.equal(f.chat.connections.get(id),current);assert.equal(current.chatId,'new-room');assert.equal(current.status,'connected');
});

test('initial YouTube polling failure rejects connect and preserves the visible error state',async t=>{
 const f=fixture(t,async url=>url.includes('/videos?')?response({items:[{liveStreamingDetails:{activeLiveChatId:'room'}}]}):response({error:'quota denied'},403));
 f.chat.auth.token=async()=>({id:'host',name:'Host',accessToken:'private'});
 const id=f.studio.saveChannel({name:'YouTube',platform:'YouTube',url:'rtmp://localhost/live',key:'stream'});
 await assert.rejects(f.chat.connect({channelId:id,resource:'abcdefghijk',confirmed:true}),/denied chat access/);
 const c=f.chat.connections.get(id);assert.equal(c.status,'error');assert.match(c.error,/denied chat access/);assert.equal(c.timer,undefined);
});

test('disconnect during the first YouTube poll cancels the original connect completion',async t=>{
 let release;const hold=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,async url=>{if(url.includes('/videos?'))return response({items:[{liveStreamingDetails:{activeLiveChatId:'room'}}]});await hold;return response({items:[],pollingIntervalMillis:30000});});
 f.chat.auth.token=async()=>({id:'host',name:'Host',accessToken:'private'});
 const id=f.studio.saveChannel({name:'YouTube',platform:'YouTube',url:'rtmp://localhost/live',key:'stream'});
 const connecting=f.chat.connect({channelId:id,resource:'abcdefghijk',confirmed:true});await turn();f.chat.disconnect(id);release();
 await assert.rejects(connecting,error=>error.status===409);assert.equal(f.chat.connections.has(id),false);
});

test('OAuth account identity and granted scopes require the documented provider types',async t=>{
 let value;const f=fixture(t,async()=>response(value));f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};
 for(const [provider,payload]of [
  ['Twitch',{client_id:'abcdefgh123',user_id:123,login:'Host',scopes:['user:read:chat','user:write:chat']}],
  ['Twitch',{client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:'user:read:chat user:write:chat'}],
  ['YouTube',{items:[{id:123,snippet:{title:'Host'}}]}],
  ['YouTube',{items:[{id:{invalid:true},snippet:{title:'Host'}}]}]
 ]){
  value=payload;await assert.rejects(f.chat.auth.accept(provider,{access_token:'private',expires_in:3600}),/permission|authorized|response/);
  assert.equal(f.chat.auth.data.accounts[provider],undefined);
 }
});

test('a YouTube poll waiting for credentials cannot read a disconnected chat',async t=>{
 let release,reads=0;const hold=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,async()=>{reads++;return response({items:[],pollingIntervalMillis:30000});});
 f.chat.auth.token=async()=>{await hold;return {id:'host',name:'Host',accessToken:'private'};};
 const c={id:'chat',chatId:'room',platform:'YouTube',status:'connected'};f.chat.connections.set(c.id,c);
 const polling=f.chat.pollYouTube(c);f.chat.disconnect(c.id);release();await polling;
 assert.equal(reads,0);assert.equal(f.chat.connections.has(c.id),false);
});

test('Twitch welcome redelivery keeps one subscription and preserves an in-flight subscription',async t=>{
 let release,subscriptions=0;const hold=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,async url=>{if(url.includes('users?'))return response({data:[{id:'broadcaster'}]});subscriptions++;await hold;return response({data:[{id:'subscription',status:'enabled'}]},202);});
 f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};
 f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'private',expires:Date.now()+3600000,validated:Date.now()};
 const id=f.studio.saveChannel({name:'Twitch',platform:'Twitch',url:'rtmp://localhost/live',key:'stream'});
 await f.chat.connect({channelId:id,resource:'host_channel',confirmed:true});const socket=f.sockets[0];
 const welcome=()=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({metadata:{message_id:'same-welcome',message_type:'session_welcome'},payload:{session:{id:'same-session',keepalive_timeout_seconds:60}}})}));
 welcome();await turn();assert.equal(subscriptions,1);welcome();await turn();
 try{assert.equal(socket.closeCount,0);assert.equal(f.chat.connections.get(id).status,'connecting');}finally{release();}
 await turn();assert.equal(f.chat.connections.get(id).status,'connected');
 welcome();await turn();assert.equal(socket.closeCount,0);assert.equal(subscriptions,1);
});

test('idle Twitch authorizations validate hourly and end every chat session after revocation',async t=>{
 let validations=0;const f=fixture(t,async()=>{validations++;return validations===1?response({client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:['user:read:chat','user:write:chat']}):response({message:'invalid access token'},401);});
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});await f.chat.auth.accept('Twitch',{access_token:'private',expires_in:7200});
 const c={id:'chat',platform:'Twitch',status:'connected'};f.chat.connections.set(c.id,c);
 t.mock.timers.tick(3600000);await turn();
 assert.equal(validations,2);assert.equal(f.chat.auth.state().Twitch.authorized,false);assert.equal(f.chat.connections.has(c.id),false);
});

test('temporary Twitch validation failures retain authorization and retry without ending sessions',async t=>{
 let validations=0;const f=fixture(t,async()=>{validations++;return validations===2?response({message:'temporarily unavailable'},503):response({client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:['user:read:chat','user:write:chat']});});
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});await f.chat.auth.accept('Twitch',{access_token:'private',expires_in:7200});
 const c={id:'chat',platform:'Twitch',status:'connected'};f.chat.connections.set(c.id,c);
 t.mock.timers.tick(3600000);await turn();assert.equal(validations,2);assert.equal(f.chat.auth.state().Twitch.authorized,true);assert.equal(f.chat.connections.get(c.id),c);
 t.mock.timers.tick(60000);await turn();assert.equal(validations,3);assert.equal(f.chat.auth.state().Twitch.authorized,true);
});

test('saved Twitch authorizations are validated on startup and clock false suppresses background checks',async t=>{
 let validations=0;const request=async()=>{validations++;return response({client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:['user:read:chat','user:write:chat']});};
 const f=fixture(t,request);t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});await f.chat.auth.accept('Twitch',{access_token:'private',expires_in:7200});await f.chat.shutdown();
 const inactive=new UnifiedChat(f.studio,{base:'http://127.0.0.1:4317',request,clock:false});t.after(()=>inactive.shutdown());
 t.mock.timers.tick(0);await turn();assert.equal(validations,1);
 const reloaded=new UnifiedChat(f.studio,{base:'http://127.0.0.1:4317',request});t.after(()=>reloaded.shutdown());
 t.mock.timers.tick(0);await turn();assert.equal(validations,2);
 await reloaded.shutdown();t.mock.timers.tick(3600000);await turn();assert.equal(validations,2);
});

test('a replacement OAuth identity invalidates replies confirmed during its authorization flow',async t=>{
 let release,lookups=0,posts=0;const hold=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,async(url,options)=>{if(options.method==='POST'){posts++;return response({id:'sent'});}return response({items:[{id:'new-owner',snippet:{title:'New host'}}]});});
 f.chat.auth.configure('YouTube',{clientId:'123-test.apps.googleusercontent.com'});
 f.chat.auth.data.accounts.YouTube={id:'old-owner',name:'Old host',accessToken:'old-private',expires:Date.now()+3600000};
 await f.chat.auth.begin('YouTube');const version=f.chat.auth.versions.YouTube;
 const c={id:'chat',chatId:'room',platform:'YouTube',status:'connected'};f.chat.connections.set(c.id,c);
 f.chat.auth.token=async()=>{if(++lookups===2)await hold;return f.chat.auth.data.accounts.YouTube;};
 const sending=f.chat.send({connectionId:c.id,text:'Confirmed while Old host was selected',requestId:crypto.randomUUID(),confirmed:true});await turn();
 try{await f.chat.auth.accept('YouTube',{access_token:'new-private',expires_in:3600},version);}finally{release();}
 await assert.rejects(sending,/changed|authorization|account/);
 assert.equal(posts,0);assert.equal(f.chat.auth.data.accounts.YouTube.id,'new-owner');assert.equal(f.chat.connections.has(c.id),false);
});

test('an active Twitch API 401 ends current sessions while preserving a pending replacement authorization',async t=>{
 const f=fixture(t,async url=>url.endsWith('/device')?response({device_code:'device',user_code:'CODE',verification_uri:'https://www.twitch.tv/activate',expires_in:600}):response({message:'invalid access token'},401));
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});
 f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'private',expires:Date.now()+7200000,validated:Date.now()};
 await f.chat.auth.begin('Twitch');const pending=f.chat.auth.pending.get('Twitch');
 const c={id:'chat',broadcasterId:'broadcaster',platform:'Twitch',status:'connected'};f.chat.connections.set(c.id,c);
 await assert.rejects(f.chat.send({connectionId:c.id,text:'Reply',requestId:crypto.randomUUID(),confirmed:true}),error=>error.status===401);
 assert.equal(f.chat.connections.has(c.id),false);assert.equal(f.chat.auth.state().Twitch.authorized,false);assert.equal(f.chat.auth.pending.get('Twitch'),pending);
});

test('a delayed Twitch API 401 cannot revoke credentials refreshed after that request began',async t=>{
 let release;const hold=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,async(url,options)=>{if(url.endsWith('/validate'))return response({client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:['user:read:chat','user:write:chat']});assert.equal(options.headers.Authorization,'Bearer old-private');await hold;return response({message:'invalid access token'},401);});
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});
 f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'old-private',expires:Date.now()+7200000,validated:Date.now()};
 const c={id:'chat',broadcasterId:'broadcaster',platform:'Twitch',status:'connected'};f.chat.connections.set(c.id,c);
 const sending=f.chat.send({connectionId:c.id,text:'Reply',requestId:crypto.randomUUID(),confirmed:true});await turn();
 try{await f.chat.auth.accept('Twitch',{access_token:'new-private',expires_in:7200});}finally{release();}
 await assert.rejects(sending,error=>error.status===401);
 assert.equal(f.chat.auth.data.accounts.Twitch.accessToken,'new-private');assert.equal(f.chat.connections.get(c.id),c);
});

test('a temporary Twitch validation outage preserves a single-use refresh token rotation across restart',async t=>{
 let refreshes=0,validations=0;
 const request=async(url,options)=>{
  if(url.endsWith('/token')){refreshes++;assert.equal(new URLSearchParams(options.body).get('refresh_token'),'old-refresh');return response({access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:14400});}
  assert.equal(options.headers.Authorization,'OAuth rotated-access');
  if(++validations===1)return response({message:'temporarily unavailable'},503);
  return response({client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:['user:read:chat','user:write:chat']});
 };
 const f=fixture(t,request);f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});
 f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'old-access',refreshToken:'old-refresh',expires:0,validated:0};
 await assert.rejects(f.chat.auth.token('Twitch'),error=>error.status===502);
 assert.equal(f.chat.auth.data.accounts.Twitch.refreshToken,'rotated-refresh');assert.equal(f.chat.auth.data.accounts.Twitch.validated,0);
 assert.ok(!fs.readFileSync(f.chat.auth.file,'utf8').includes('rotated-refresh'));
 await f.chat.shutdown();
 const reloaded=new UnifiedChat(f.studio,{base:'http://127.0.0.1:4317',request,clock:false});t.after(()=>reloaded.shutdown());
 const account=await reloaded.auth.token('Twitch');assert.equal(account.accessToken,'rotated-access');assert.equal(account.refreshToken,'rotated-refresh');
 assert.equal(refreshes,1);assert.equal(validations,2);assert.ok(account.validated>0);
});

test('a Twitch reconnect grants the handoff window even when the previous keepalive deadline is near',async t=>{
 const f=fixture(t,async url=>response(url.includes('users?')?{data:[{id:'broadcaster'}]}:{data:[{id:'subscription',status:'enabled'}]},url.includes('users?')?200:202));
 f.chat.auth.data.settings.Twitch={clientId:'abcdefgh123'};f.chat.auth.data.accounts.Twitch={id:'host',name:'Host',accessToken:'private',expires:Date.now()+3600000,validated:Date.now()};
 t.mock.timers.enable({apis:['setTimeout']});
 const id=f.studio.saveChannel({name:'Twitch',platform:'Twitch',url:'rtmp://localhost/live',key:'stream'});await f.chat.connect({channelId:id,resource:'host_channel',confirmed:true});
 const emit=(socket,type,payload)=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({metadata:{message_type:type},payload})}));
 const first=f.sockets[0];emit(first,'session_welcome',{session:{id:'first',keepalive_timeout_seconds:10}});await turn();
 t.mock.timers.tick(9000);emit(first,'session_reconnect',{session:{reconnect_url:'wss://eventsub.wss.twitch.tv/ws?reconnect=handoff'}});await turn();const second=f.sockets[1];
 emit(first,'notification',{subscription:{type:'channel.chat.message'},event:{broadcaster_user_id:'broadcaster',message_id:'during-handoff',message:{text:'Still receiving the old connection'}}});emit(first,'session_keepalive',{});await turn();
 t.mock.timers.tick(20000);assert.equal(first.closeCount,0);assert.equal(second.closeCount,0);
 emit(second,'session_welcome',{session:{id:'second',keepalive_timeout_seconds:null}});await turn();
 assert.equal(f.chat.connections.get(id).status,'connected');assert.equal(first.closeCount,1);assert.equal(second.closeCount,0);assert.equal(f.chat.messages.length,1);
});

test('a Twitch device polling timeout backs off and retains the active authorization until approval',async t=>{
 let polls=0;const f=fixture(t,async url=>{
  if(url.endsWith('/device'))return response({device_code:'device',user_code:'CODE',verification_uri:'https://www.twitch.tv/activate',expires_in:600,interval:5});
  if(url.endsWith('/validate'))return response({client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:['user:read:chat','user:write:chat']});
  if(++polls===1)throw new DOMException('Connection timed out','TimeoutError');
  if(polls===2)return response({message:'slow_down'},400);
  return response({access_token:'access',refresh_token:'refresh',expires_in:14400});
 });
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});await f.chat.auth.begin('Twitch');const pending=f.chat.auth.pending.get('Twitch');
 t.mock.timers.tick(5000);await turn();assert.equal(polls,1);assert.equal(f.chat.auth.pending.get('Twitch'),pending);assert.equal(pending.interval,10000);
 t.mock.timers.tick(9999);await turn();assert.equal(polls,1);t.mock.timers.tick(1);await turn();assert.equal(polls,2);assert.equal(pending.interval,15000);
 t.mock.timers.tick(14999);await turn();assert.equal(polls,2);t.mock.timers.tick(1);await turn();
 assert.equal(polls,3);assert.equal(f.chat.auth.state().Twitch.authorized,true);assert.equal(f.chat.auth.pending.has('Twitch'),false);
});

test('a Twitch device response body timeout backs off after headers instead of cancelling sign-in',async t=>{
 let polls=0;const f=fixture(t,async url=>{
  if(url.endsWith('/device'))return response({device_code:'device',user_code:'CODE',verification_uri:'https://www.twitch.tv/activate',expires_in:600,interval:5});
  if(url.endsWith('/validate'))return response({client_id:'abcdefgh123',user_id:'host',login:'Host',scopes:['user:read:chat','user:write:chat']});
  if(++polls===1)return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},pull(controller){controller.error(new DOMException('Response body timed out','TimeoutError'));}}));
  return response({access_token:'access',refresh_token:'refresh',expires_in:14400});
 });
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
 f.chat.auth.configure('Twitch',{clientId:'abcdefgh123'});await f.chat.auth.begin('Twitch');const pending=f.chat.auth.pending.get('Twitch');
 t.mock.timers.tick(5000);await turn();assert.equal(polls,1);assert.equal(f.chat.auth.pending.get('Twitch'),pending);assert.equal(pending.interval,10000);
 t.mock.timers.tick(9999);await turn();assert.equal(polls,1);t.mock.timers.tick(1);await turn();
 assert.equal(polls,2);assert.equal(f.chat.auth.state().Twitch.authorized,true);
});

test('shutdown during a provider response body reports closing and drains tracked operations',async t=>{
 let reading;const started=new Promise(resolve=>{reading=resolve;});
 const f=fixture(t,async(url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});reading();}})));
 const request=f.chat.auth.http('https://api.twitch.tv/helix/users');
 const rejected=assert.rejects(request,error=>error.status===409&&/closing/.test(error.message));
 await started;await f.chat.shutdown();await rejected;assert.equal(f.chat.auth.operations.size,0);
});
