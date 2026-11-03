import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createApplication} from '../src/server.mjs';
import {defaultDataDirectory,showStartupError} from '../src/desktop.mjs';
import {decryptBackup} from '../src/backups.mjs';
import {Updates,verifyRelease} from '../src/updates.mjs';
import {dispatch} from './transport.mjs';

function directory(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'streamland-core-'));
 t.after(()=>{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('streamland-core-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
async function application(t,options={}){
 const root=directory(t),app=await createApplication({directory:root,listen:false,clock:false,portableVault:true,...options});
 t.after(()=>app.close());return app;
}
const headers=app=>({Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'});

test('Streamland keeps the installed data identity on Windows and Mac',t=>{
 const root=directory(t),local=path.join(root,'Local'),home=path.join(root,'Home');
 fs.writeFileSync(path.join(root,'.installed'),'go-streams-installed-v1\n');
 assert.equal(defaultDataDirectory(root,{platform:'win32',localData:local}),path.join(local,'Go Streams','data'));
 assert.equal(defaultDataDirectory(root,{platform:'darwin',home}),path.join(home,'Library','Application Support','Go Streams'));
 assert.equal(defaultDataDirectory(root,{platform:'win32',installed:false}),path.join(root,'data'));
});

test('Streamland restores a backup encrypted with the previous application format',async t=>{
 const app=await application(t),password='Legacy-backup-password-123';
 const payload={version:1,scope:'all',data:{media:[],channels:[{id:'existing-channel',name:'Existing channel',url:'rtmp://localhost/live',platform:'Personalizado',key:'preserved-private-key'}],playlists:[],schedules:[],channelPlans:{},history:[],downloads:[],settings:{}},interface:{language:'pt-PT',layout:'grid',compact:true}};
 // An independent legacy writer: do not derive the identity from the current exporter.
 const salt=Buffer.alloc(16,5),iv=Buffer.alloc(12,9),key=crypto.scryptSync(password,salt,32);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('Go Streams encrypted backup v1'));
 const bytes=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);key.fill(0);
 const backup={kind:'go-streams-backup',version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')};
 assert.deepEqual(await decryptBackup(backup,password),payload);
 const response=await dispatch(app,'/api/backups/restore',{method:'POST',headers:headers(app),body:JSON.stringify({backup,password,confirmed:true})});
 assert.equal(response.status,200);assert.deepEqual((await response.json()).interface,payload.interface);
 assert.equal(app.store.data.channels[0].id,'existing-channel');
 assert.equal(app.studio.vault.decrypt(app.store.data.channels[0].secret),'preserved-private-key');
 assert.equal(app.studio.jobs.size,0);
});

test('Streamland export names and startup messages use the new brand with the existing API session',async t=>{
 const app=await application(t);
 const unauthorized=await dispatch(app,'/api/state');assert.equal(unauthorized.status,401);assert.match(await unauthorized.text(),/Streamland/);
 const ready=await dispatch(app,'/api/ready',{headers:headers(app)});assert.equal(ready.status,200);assert.equal(ready.headers.get('x-go-streams-ready'),'1');
 for(const [route,name] of [['/api/export','streamland-project.json'],['/api/history.csv','streamland-history.csv']]){
  const response=await dispatch(app,route,{headers:headers(app)});assert.equal(response.status,200,route);assert.equal(response.headers.get('content-disposition'),'attachment; filename="'+name+'"');
 }
 let args;await showStartupError('Example problem',{platform:'darwin',execute:async(_command,input)=>{args=input;return{stdout:''};}});
 assert.ok(args.some(value=>value.includes('displayAlert("Streamland"')));
});

test('Streamland notification messages retain existing SMTP credentials',async t=>{
 const sent=[],app=await application(t,{notificationOptions:{send:async(config,message)=>sent.push({config,message})}});
 app.notifications.save({enabled:true,host:'smtp.example.test',port:465,security:'tls',username:'owner',password:'preserved-smtp-password',from:'owner@example.test',to:'owner@example.test'});
 assert.equal((await app.notifications.test(true)).ok,true);
 app.notifications.enqueue({channelName:'Existing channel',playlistName:'Existing playlist',elapsed:3},'running');await app.notifications.processing;
 app.notifications.enqueueSchedule({result:'missed',playlist:'Existing playlist',channel:'Existing channel',at:'2099-01-01',timeZone:'UTC'});await app.notifications.processing;
 assert.equal(sent.length,3);assert.ok(sent.every(({message,config})=>message.subject.startsWith('Streamland')&&config.password==='preserved-smtp-password'));
 assert.match(sent[0].message.body,/Streamland/);
});

for(const product of ['go-streams','streamland'])test('Streamland accepts the signed '+product+' feed and names its downloaded package consistently',async t=>{
 const root=directory(t),archive=Buffer.from('verified package fixture'),keys=crypto.generateKeyPairSync('ed25519');
 const key=keys.publicKey.export({type:'spki',format:'pem'});
 const payload=Buffer.from(JSON.stringify({product,platform:process.platform,version:'99.0.0',url:'https://updates.example.test/app.zip',bytes:archive.length,sha256:crypto.createHash('sha256').update(archive).digest('hex')}));
 const envelope={payload:payload.toString('base64'),signature:crypto.sign(null,payload,keys.privateKey).toString('base64')};
 assert.equal(verifyRelease(envelope,key,'1.2.0').available,true);
 const store={directory:root,data:{},update(fn){fn(this.data);}},updates=new Updates(store,{version:'1.2.0',fetcher:async url=>new Response(url.endsWith('.json')?JSON.stringify(envelope):archive)});t.after(()=>updates.shutdown());
 updates.save({feed:'https://updates.example.test/feed.json',publicKey:key});await updates.check();await updates.download();
 assert.equal(path.basename(updates.state().package),'Streamland-99.0.0.zip');assert.deepEqual(fs.readFileSync(updates.state().package),archive);
});
