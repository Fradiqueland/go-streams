import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Store} from '../src/core.mjs';
import {Updates,verifyRelease,newer} from '../src/updates.mjs';
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'updates-'));const closers=[];
after(async()=>{for(const u of closers)await u.shutdown();if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('updates-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');const key=publicKey.export({type:'spki',format:'pem'});const archive=Buffer.from('controlled package fixture');
function manifest(overrides={}){const release={product:'go-streams',platform:process.platform,version:'99.0.0',url:'https://updates.example.test/app.zip',sha256:crypto.createHash('sha256').update(archive).digest('hex'),bytes:archive.length,...overrides};const payload=Buffer.from(JSON.stringify(release));return{payload:payload.toString('base64'),signature:crypto.sign(null,payload,privateKey).toString('base64')};}
function make(fetcher){const store=new Store(fs.mkdtempSync(path.join(root,'data-')));const u=new Updates(store,{fetcher});closers.push(u);u.save({feed:'https://updates.example.test/latest.json',publicKey:key});return u;}
test('signed manifests reject tampering, foreign keys, product and executable URLs',()=>{assert.equal(verifyRelease(manifest(),key,'0.4.0').available,true);assert.equal(newer('0.4.0','0.4.0'),false);assert.equal(newer('0.10.0','0.9.0'),true);const bad=manifest();bad.payload=Buffer.from('{}').toString('base64');assert.throws(()=>verifyRelease(bad,key,'0.4.0'),/assinatura/);const other=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});assert.throws(()=>verifyRelease(manifest(),other,'0.4.0'),/assinatura/);for(const input of [{product:'other'},{url:'file:///C:/Windows/x.exe'},{sha256:'bad'},{bytes:-1},{version:'../x'}])assert.throws(()=>verifyRelease(manifest(input),key,'0.4.0'));});
test('update checks are opt-in, reject unsigned sources and bound remote data',async()=>{let fetches=0;const u=make(async()=>{fetches++;return new Response(JSON.stringify(manifest()));});assert.equal(fetches,0);assert.throws(()=>u.save({feed:'http://example.test',publicKey:key}),/HTTPS/);assert.throws(()=>u.save({feed:'https://example.test',publicKey:'x'}),/Ed25519/);await u.check();assert.equal(fetches,1);assert.equal(u.state().state,'available');u.fetcher=async()=>new Response('x'.repeat(40000));await assert.rejects(u.check());assert.equal(u.state().state,'error');assert.equal(u.release,null);});
test('download verifies size and hash, cleans rejected files and preserves installed data',async()=>{const u=make(async url=>new Response(url.endsWith('json')?JSON.stringify(manifest()):archive));await u.check();await u.download();const saved=u.state();assert.equal(saved.state,'downloaded');assert.deepEqual(fs.readFileSync(saved.package),archive);assert.ok(fs.existsSync(u.store.file));await u.check();u.fetcher=async()=>new Response(Buffer.from('wrong contents'));await assert.rejects(u.download(),/corresponde/);assert.deepEqual(fs.readFileSync(saved.package),archive);assert.ok(!fs.readdirSync(path.join(u.store.directory,'updates')).some(x=>x.endsWith('.part')));});
test('closing aborts a pending update request without executing any package',async()=>{const u=make(async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));const pending=u.check();await assert.rejects(u.check(),/curso/);await u.shutdown();await assert.rejects(pending);assert.equal(u.state().state,'error');});


for(const operation of ['check','download'])test('shutdown rejects a late '+operation+' response even when the transport ignores cancellation',async()=>{
 const u=make(async()=>new Response(JSON.stringify(manifest())));if(operation==='download')await u.check();
 let release,started;const gate=new Promise(r=>{release=r;}),reading=new Promise(r=>{started=r;});
 u.fetcher=async()=>{started();await gate;return new Response(operation==='check'?JSON.stringify(manifest()):archive);};
 const pending=u[operation]();const outcome=pending.then(value=>({value}),error=>({error}));await reading;
 const closing=u.shutdown();release();await closing;const result=await outcome;
 assert.ok(result.error,'late responses must not complete successfully');assert.equal(u.state().state,'error');
 if(operation==='check')assert.equal(u.release,null);else assert.deepEqual(fs.readdirSync(path.join(u.store.directory,'updates')),[]);
});


for(const operation of ['check','download'])for(const stage of ['partial','end'])test('shutdown during '+operation+' body '+stage+' preserves installed files and clears partial output',async()=>{
 const u=make(async()=>new Response(JSON.stringify(manifest())));if(operation==='download')await u.check();
 const bytes=operation==='check'?Buffer.from(JSON.stringify(manifest())):archive;
 let release,started;const gate=new Promise(r=>{release=r;}),reading=new Promise(r=>{started=r;});
 let target;
 if(operation==='download'){const folder=path.join(u.store.directory,'updates');fs.mkdirSync(folder,{recursive:true});target=path.join(folder,'GoStreams-99.0.0.zip');fs.writeFileSync(target,'previously verified');}
 u.fetcher=async()=>({ok:true,body:{async *[Symbol.asyncIterator](){yield stage==='partial'?bytes.subarray(0,2):bytes;started();await gate;if(stage==='partial')yield bytes.subarray(2);}}});
 const outcome=u[operation]().then(value=>({value}),error=>({error}));await reading;const closing=u.shutdown();release();await closing;
 assert.ok((await outcome).error);assert.equal(u.state().state,'error');
 if(operation==='check')assert.equal(u.release,null);else{assert.equal(fs.readFileSync(target,'utf8'),'previously verified');assert.ok(!fs.readdirSync(path.dirname(target)).some(name=>name.endsWith('.part')));}
});
