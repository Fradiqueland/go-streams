import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {LocalRecordings} from '../src/local-recordings.mjs';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';
function fixture(t){const root=fs.mkdtempSync(path.resolve('.tmp/delete-recording-')),studio={store:{directory:root}},recordings=new LocalRecordings(studio,{clock:false});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,recordings};}
function item(recordings,status='completed',format='mp4'){const entry={id:crypto.randomUUID(),format,kind:format==='m4a'?'audio':'video',created:new Date().toISOString(),status,bytes:4};recordings.items.push(entry);return entry;}
test('deleting a completed video or audio removes only its own files and persists the updated list',t=>{
 const {root,recordings}=fixture(t),original=path.join(root,'original.mp4');fs.writeFileSync(original,'keep');
 for(const format of ['mp4','m4a','webm']){const entry=item(recordings,'completed',format),file=path.join(recordings.root,entry.id+'.'+format),part=path.join(recordings.root,entry.id+'.part');fs.writeFileSync(file,'data');fs.writeFileSync(part,'recovery');assert.deepEqual(recordings.remove(entry.id,{confirmed:true}),{ok:true,id:entry.id});assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(part),false);}
 assert.equal(fs.readFileSync(original,'utf8'),'keep');assert.deepEqual(JSON.parse(fs.readFileSync(recordings.file)),[]);
});
test('interrupted and missing files can be removed from their original custom folder after preferences change',t=>{
 const {root,recordings}=fixture(t),entry=item(recordings,'interrupted');entry.directory=path.join(root,'chosen');fs.mkdirSync(entry.directory);fs.writeFileSync(path.join(entry.directory,entry.id+'.part'),'data');recordings.preferences.directory=path.join(root,'different');recordings.remove(entry.id,{confirmed:true});assert.equal(fs.readdirSync(entry.directory).length,0);
 const missing=item(recordings);recordings.remove(missing.id,{confirmed:true});assert.deepEqual(recordings.items,[]);
});
test('deletion requires explicit confirmation and rejects recording, finalizing and unknown entries',t=>{
 const {recordings}=fixture(t),entry=item(recordings);assert.throws(()=>recordings.remove(entry.id),/Confirm/);assert.throws(()=>recordings.remove('../index',{confirmed:true}),/not found/);
 for(const status of ['recording','finalizing']){entry.status=status;assert.throws(()=>recordings.remove(entry.id,{confirmed:true}),/Stop/);}entry.status='completed';recordings.active.set(entry.id,{});assert.throws(()=>recordings.remove(entry.id,{confirmed:true}),/Stop/);recordings.active.clear();recordings.finalizing.set(entry.id,Promise.resolve());assert.throws(()=>recordings.remove(entry.id,{confirmed:true}),/Stop/);
});
test('an unexpected directory in a recording filename is preserved and never recursively removed',t=>{
 const {recordings}=fixture(t),entry=item(recordings),file=path.join(recordings.root,entry.id+'.mp4');fs.mkdirSync(file);fs.writeFileSync(path.join(file,'keep'),'keep');assert.throws(()=>recordings.remove(entry.id,{confirmed:true}),/regular file/);assert.equal(fs.readFileSync(path.join(file,'keep'),'utf8'),'keep');assert.equal(recordings.items.length,1);
});
test('failed deletion and index writes retain a retryable history entry and report the problem',t=>{
 const {recordings}=fixture(t),entry=item(recordings),file=path.join(recordings.root,entry.id+'.mp4');fs.writeFileSync(file,'data');
 const unlink=fs.unlinkSync;t.mock.method(fs,'unlinkSync',()=>{throw Object.assign(Error('locked'),{code:'EBUSY'});});assert.throws(()=>recordings.remove(entry.id,{confirmed:true}),/Close any player/);assert.equal(fs.readFileSync(file,'utf8'),'data');t.mock.restoreAll();assert.equal(fs.unlinkSync,unlink);
 t.mock.method(recordings,'save',()=>{throw Error('Full');});assert.throws(()=>recordings.remove(entry.id,{confirmed:true}),/list could not be saved/);assert.equal(recordings.items.length,1);assert.equal(fs.existsSync(file),false);
});
test('recording deletion HTTP endpoint enforces session, CSRF, confirmation and inactive state',async t=>{
 const directory=fs.mkdtempSync(path.resolve('.tmp/delete-api-')),app=await createApplication({directory,listen:false,clock:false});t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
 const entry=item(app.recordings),url='/api/recordings/'+entry.id;
 const request=options=>dispatch(app,url,{method:'DELETE',...options,body:JSON.stringify(options.body)});assert.equal((await request({body:{confirmed:true}})).status,401);
 const headers={Cookie:'go_streams='+app.token,'Content-Type':'application/json'};assert.equal((await request({headers,body:{confirmed:true}})).status,403);
 headers['X-Go-Streams']='1';assert.equal((await request({headers,body:{confirmed:false}})).status,400);entry.status='recording';assert.equal((await request({headers,body:{confirmed:true}})).status,409);entry.status='completed';assert.equal((await request({headers,body:{confirmed:true}})).status,200);assert.equal(app.recordings.items.length,0);
});
