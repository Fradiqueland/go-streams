import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';

for(const [url,method,body] of [
 ['/api/channels','POST',{name:'Late channel',url:'rtmp://127.0.0.1:9/live',key:'SECRET'}],
 ['/api/settings','PUT',{ffmpeg:''}],
 ['/api/playlists','POST',{name:'Late playlist',mediaIds:[]}]
])test('shutdown rejects a request whose body arrives late: '+url,async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'request-lifecycle-'));
 const app=await createApplication({directory,listen:false,clock:false,portableVault:true});
 t.after(async()=>{await app.close();if(!directory.startsWith(parent+path.sep)||!path.basename(directory).startsWith('request-lifecycle-'))throw Error('Unsafe cleanup');fs.rmSync(directory,{recursive:true,force:true});});
 let release,started;const hold=new Promise(r=>{release=r;}),reading=new Promise(r=>{started=r;});
 async function* chunks(){started();await hold;yield Buffer.from(JSON.stringify(body));}
 const pending=dispatch(app,url,{method,headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'},bodyChunks:chunks()});
 try{await reading;await app.close();const before=JSON.stringify(app.store.data);release();const response=await pending;assert.equal(response.status,503);assert.equal(JSON.stringify(app.store.data),before);}finally{release();await pending;}
});


for(const failure of [false,true])test('server shutdown closes active HTTP connections after draining services'+(failure?' even on failure':''),async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'request-lifecycle-'));
 const app=await createApplication({directory,listen:false,clock:false,portableVault:true});let finish,forced=0;const calls=[];
 t.after(async()=>{finish?.();await app.close().catch(()=>{});if(!directory.startsWith(parent+path.sep)||!path.basename(directory).startsWith('request-lifecycle-'))throw Error('Unsafe cleanup');fs.rmSync(directory,{recursive:true,force:true});});
 Object.defineProperty(app.server,'listening',{get:()=>true});
 for(const [name,service] of [['updates',app.updates],['notifications',app.notifications],['downloads',app.downloads],['studio',app.studio]]){const shutdown=service.shutdown.bind(service);service.shutdown=async()=>{await shutdown();calls.push(name);if(failure&&name==='updates')throw Error('Controlled failure');};}
 app.server.close=callback=>{calls.push('server');finish=callback;return app.server;};
 app.server.closeIdleConnections=()=>{};app.server.closeAllConnections=()=>{forced++;finish();};
 const closing=app.close();const outcome=closing.then(()=>null,error=>error);
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(forced,1);assert.equal(calls.at(-1),'server');assert.equal(calls.length,5);assert.equal(Boolean(await outcome),failure);}finally{finish?.();await outcome;}
});
