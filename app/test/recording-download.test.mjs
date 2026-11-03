import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';

for(const [kind,format,type] of [['audio','webm','audio/webm'],['video','webm','video/webm'],['audio','m4a','audio/mp4'],['video','mp4','video/mp4']]){
 test(`${kind} ${format} downloads preserve media type, byte ranges and HEAD metadata`,async t=>{
  const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'recording-download-'));
  const app=await createApplication({directory,listen:false,clock:false,portableVault:true});
  t.after(async()=>{await app.close();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
  const id=crypto.randomUUID(),bytes=Buffer.from('local-recording-payload');
  app.recordings.items.push({id,kind,format,status:'completed',created:new Date().toISOString(),bytes:bytes.length,error:''});
  fs.writeFileSync(app.recordings.media(id),bytes);
  const url=`/api/recordings/${id}/file`,headers={Cookie:'go_streams='+app.token};
  const download=await dispatch(app,url,{headers});assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),type);assert.deepEqual(download.body,bytes);assert.match(download.headers.get('content-disposition'),new RegExp(`\\.${format}"$`));
  const head=await dispatch(app,url,{method:'HEAD',headers});assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),type);assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal(head.body.length,0);
  const range=await dispatch(app,url,{headers:{...headers,Range:'bytes=6-14'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-type'),type);assert.equal(range.headers.get('content-range'),`bytes 6-14/${bytes.length}`);assert.deepEqual(range.body,bytes.subarray(6,15));
 });
}

test('the recording API removes an explicitly cancelled start before any upload',async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'recording-download-'));
 const app=await createApplication({directory,listen:false,clock:false,portableVault:true});
 t.after(async()=>{await app.close();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const headers={Cookie:'go_streams='+app.token,'X-Go-Streams':'1','Content-Type':'application/json'};
 const started=await dispatch(app,'/api/recordings/start',{method:'POST',headers,body:JSON.stringify({confirmed:true})});assert.equal(started.status,201);const {id}=await started.json();
 const stopped=await dispatch(app,`/api/recordings/${id}/finish`,{method:'POST',headers,body:JSON.stringify({discardEmpty:true})});assert.equal(stopped.status,200);assert.equal((await stopped.json()).discarded,true);assert.equal(app.recordings.state().length,0);assert.equal(app.recordings.active.size,0);
});
