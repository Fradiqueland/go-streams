import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {Store,runProcess} from '../src/core.mjs';
import {Downloads} from '../src/downloads.mjs';
function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'download-edge-'));
 t.after(()=>{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('download-edge-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
 const store=new Store(path.join(root,'data'));return {root,store,studio:{store}};
}
function child(){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>setImmediate(()=>c.emit('close',null));return c;}

test('incomplete portable runtime records failure and releases download capacity before shutdown',async t=>{
 const f=fixture(t),copy=path.join(f.root,'broken-portable');fs.mkdirSync(path.join(copy,'runtime'),{recursive:true});
 fs.cpSync(new URL('../src/',import.meta.url),path.join(copy,'src'),{recursive:true});
 const {Downloads:PackagedDownloads}=await import(pathToFileURL(path.join(copy,'src/downloads.mjs')).href);
 let spawned=0;const d=new PackagedDownloads(f.studio,{spawnProcess:()=>{spawned++;return child();}});
 const item=d.start({url:'https://youtu.be/abcdefghijk'});
 assert.equal(item.status,'error');assert.equal(spawned,0);assert.equal(d.active.size,0);assert.equal(f.store.data.downloads[0].status,'error');
 assert.equal(fs.existsSync(path.join(f.store.directory,'downloads',item.id)),false);
 await d.shutdown();
});

test('download titles survive every UTF-8 byte boundary and the final line without a newline',async t=>{
 const f=fixture(t);let c;const d=new Downloads(f.studio,{spawnProcess:()=>{c=child();return c;}});
 t.after(async()=>{c?.emit('close',1);await d.shutdown();});
 const item=d.start({url:'https://youtu.be/abcdefghijk'}),done=d.active.get(item.id).done;
 const title='António — Canção 🎵 日本語';
 for(const byte of Buffer.from('TITLE:'+title+'\n'))c.stdout.write(Buffer.from([byte]));
 assert.equal(f.store.data.downloads[0].title,title);
 c.stdout.write(Buffer.from('TITLE:'+title+' final'));c.emit('close',1);await done;
 assert.equal(f.store.data.downloads[0].title,title+' final');assert.equal(d.active.size,0);await d.shutdown();
});

test('media process JSON preserves Unicode split across stdout chunks',async()=>{
 const expected='António 🎵 日本語';
 const code=`const b=Buffer.from(JSON.stringify({title:${JSON.stringify(expected)}}));let i=0;const next=()=>{if(i<b.length){process.stdout.write(b.subarray(i,i+1));i++;setTimeout(next,3);}};next();`;
 const {stdout}=await runProcess(process.execPath,['-e',code]);assert.equal(JSON.parse(stdout).title,expected);
});

test('media process output limit counts UTF-8 bytes, not decoded characters',async()=>{
 await assert.rejects(runProcess(process.execPath,['-e',"process.stdout.write('漢'.repeat(10))"],{maxBytes:20}),/demasiado grande/);
});

test('download timeout remains an error even when the stopped child reports exit code zero',async t=>{
 const f=fixture(t);let c;const d=new Downloads(f.studio,{spawnProcess:()=>{c=child();return c;}});
 t.after(()=>d.shutdown());const item=d.start({url:'https://youtu.be/abcdefghijk'}),op=d.active.get(item.id);op.timeout=true;
 c.emit('close',0);await op.done;assert.equal(f.store.data.downloads[0].status,'error');assert.match(f.store.data.downloads[0].error,/seis horas/);assert.equal(d.active.size,0);
});
