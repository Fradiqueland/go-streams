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
 const chat=new UnifiedChat(studio,{base:'http://127.0.0.1:4317',request,socketFactory:url=>{const socket=new EventTarget();socket.url=url;socket.close=()=>socket.dispatchEvent(new Event('close'));sockets.push(socket);return socket;}});
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
 const f=fixture(t,async(url,options)=>{requests.push({url,options});if(url.includes('users?'))return response({data:[{id:'broadcaster'}]});if(url.includes('subscriptions'))return response({data:[{id:'subscription'}]},202);return response({data:[{is_sent:deliver,message_id:'reply-id'}]});});
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
