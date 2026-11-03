import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Store,Vault,Studio} from '../src/core.mjs';
import {ChatAuth} from '../src/chat-auth.mjs';
import {UnifiedChat} from '../src/unified-chat.mjs';

const response=value=>new Response(JSON.stringify(value),{status:200});
function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'chat-transaction-'));
 const studio=new Studio(new Store(root),new Vault(root,{portable:true}));
 let identity='old-host';const sent=[];
 const request=async(url,options)=>{
  if(options.method==='POST'){sent.push(options.headers.Authorization);return response({id:'sent-id'});}
  return response(url.endsWith('/validate')?{client_id:'abcdefgh123',user_id:identity,login:identity,scopes:['user:read:chat','user:write:chat']}:{items:[{id:identity,snippet:{title:identity}}]});
 };
 const chat=new UnifiedChat(studio,{base:'http://127.0.0.1:4317',request,clock:false});
 t.after(async()=>{await chat.shutdown();await studio.shutdown();assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return {root,studio,chat,request,sent,identity:value=>{identity=value;}};
}
function rejectAuthWrite(t,auth){
 const rename=fs.renameSync.bind(fs);
 return t.mock.method(fs,'renameSync',(from,to)=>{if(to===auth.file)throw Object.assign(new Error('Controlled OAuth persistence failure'),{code:'ENOSPC'});return rename(from,to);});
}
const setup={YouTube:{clientId:'123-test.apps.googleusercontent.com',clientSecret:'saved-client-secret'},Twitch:{clientId:'abcdefgh123'}};

for(const provider of ['YouTube','Twitch'])test(`failed ${provider} settings persistence preserves saved configuration and pending authorization`,async t=>{
 const f=fixture(t),auth=f.chat.auth;auth.configure(provider,setup[provider]);
 const pending={version:auth.versions[provider],state:'pending-auth'};auth.pending.set(provider,pending);
 const version=auth.versions[provider],previous=auth.data.settings[provider],disk=fs.readFileSync(auth.file);
 const failure=rejectAuthWrite(t,auth);
 assert.throws(()=>auth.configure(provider,{...setup[provider],clientSecret:'replacement-secret'}),/persistence failure/);
 assert.equal(auth.data.settings[provider],previous);assert.equal(auth.pending.get(provider),pending);assert.equal(auth.versions[provider],version);assert.deepEqual(fs.readFileSync(auth.file),disk);
 failure.mock.restore();auth.configure(provider,{...setup[provider],clientSecret:'replacement-secret'});
 assert.equal(auth.data.settings[provider].clientSecret,'replacement-secret');assert.equal(auth.pending.has(provider),false);assert.equal(auth.versions[provider],version+1);
 const reopened=new ChatAuth(f.studio,{clock:false,request:f.request});t.after(()=>reopened.shutdown());assert.equal(reopened.data.settings[provider].clientSecret,'replacement-secret');
});

for(const provider of ['YouTube','Twitch'])test(`failed ${provider} replacement persistence keeps the old identity and connection; retry commits the replacement`,async t=>{
 const f=fixture(t),auth=f.chat.auth;auth.configure(provider,setup[provider]);await auth.accept(provider,{access_token:'old-access',refresh_token:'old-refresh',expires_in:7200});
 const connection={id:'chat',platform:provider,status:'connected'};f.chat.connections.set(connection.id,connection);
 const previous=auth.data.accounts[provider],version=auth.versions[provider],disk=fs.readFileSync(auth.file);f.identity('new-host');
 const failure=rejectAuthWrite(t,auth);
 await assert.rejects(auth.accept(provider,{access_token:'new-access',refresh_token:'new-refresh',expires_in:7200}),/persistence failure/);
 assert.equal(auth.data.accounts[provider],previous);assert.equal((await auth.token(provider)).id,'old-host');assert.equal(auth.versions[provider],version);assert.equal(f.chat.connections.get('chat'),connection);assert.deepEqual(fs.readFileSync(auth.file),disk);
 failure.mock.restore();await auth.accept(provider,{access_token:'new-access',refresh_token:'new-refresh',expires_in:7200});
 assert.equal(auth.data.accounts[provider].id,'new-host');assert.equal(auth.versions[provider],version+1);assert.equal(f.chat.connections.has('chat'),false);
 const reopened=new ChatAuth(f.studio,{clock:false,request:f.request});t.after(()=>reopened.shutdown());assert.equal(reopened.data.accounts[provider].id,'new-host');
});

test('a failed first authorization never exposes credentials as an authorized account',async t=>{
 const f=fixture(t),auth=f.chat.auth;auth.configure('YouTube',setup.YouTube);const disk=fs.readFileSync(auth.file);rejectAuthWrite(t,auth);
 await assert.rejects(auth.accept('YouTube',{access_token:'unsaved-access',expires_in:7200}),/persistence failure/);
 assert.equal(auth.state().YouTube.authorized,false);assert.equal(auth.data.accounts.YouTube,undefined);assert.deepEqual(fs.readFileSync(auth.file),disk);
 await assert.rejects(auth.token('YouTube'),error=>error.status===401);
});

test('a reply confirmed under the old account cannot acquire a replacement whose disk commit failed',async t=>{
 const f=fixture(t),auth=f.chat.auth;auth.configure('YouTube',setup.YouTube);await auth.accept('YouTube',{access_token:'old-access',expires_in:7200});
 const connection={id:'chat',platform:'YouTube',status:'connected',chatId:'room'};f.chat.connections.set(connection.id,connection);
 let release,ready;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{ready=resolve;});const token=auth.token.bind(auth);let lookups=0;
 t.mock.method(auth,'token',async provider=>{if(++lookups===2){ready();await gate;}return token(provider);});
 const sending=f.chat.send({connectionId:'chat',text:'Confirmed by old-host',requestId:crypto.randomUUID(),confirmed:true});await waiting;
 f.identity('new-host');rejectAuthWrite(t,auth);
 try{await assert.rejects(auth.accept('YouTube',{access_token:'new-access',expires_in:7200}),/persistence failure/);}finally{release();}
 assert.equal((await sending).ok,true);assert.deepEqual(f.sent,['Bearer old-access']);assert.equal(f.chat.connections.get('chat'),connection);
});

test('revocation closes active Twitch sockets despite a persistence error and preserves replacement sign-in state',async t=>{
 const f=fixture(t),auth=f.chat.auth;auth.configure('Twitch',setup.Twitch);await auth.accept('Twitch',{access_token:'revoked-access',expires_in:7200});
 let closed=0;const socket={close(){closed++;}},connection={id:'chat',platform:'Twitch',status:'connected',sockets:new Map([[socket,{timer:null}]])};f.chat.connections.set('chat',connection);
 const pending={version:auth.versions.Twitch,state:'replacement-sign-in'};auth.pending.set('Twitch',pending);const account=auth.data.accounts.Twitch,disk=fs.readFileSync(auth.file);rejectAuthWrite(t,auth);
 assert.throws(()=>auth.invalidate('Twitch',account,auth.versions.Twitch),/persistence failure/);
 assert.equal(auth.data.accounts.Twitch,undefined);assert.equal(f.chat.connections.has('chat'),false);assert.equal(closed,1);assert.equal(auth.pending.get('Twitch'),pending);assert.deepEqual(fs.readFileSync(auth.file),disk);
 await assert.rejects(auth.token('Twitch'),error=>error.status===401);
});
