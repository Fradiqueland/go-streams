import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Store,runProcess} from '../src/core.mjs';
import {Downloads} from '../src/downloads.mjs';
import {RemoteSources} from '../src/remote-sources.mjs';
import {downloaderEnvironment} from '../src/tool-paths.mjs';

function electronHost(t){
 const original=Object.getOwnPropertyDescriptor(process.versions,'electron');
 Object.defineProperty(process.versions,'electron',{value:'controlled-desktop-runtime',configurable:true});
 t.after(()=>{if(original)Object.defineProperty(process.versions,'electron',original);else delete process.versions.electron;});
}

test('the downloader selects Node mode only in its Electron child environment',()=>{
 const env={PATH:'',EXISTING:'preserved'},child=downloaderEnvironment({env,electron:'controlled-desktop-runtime'});
 assert.deepEqual(child,{...env,ELECTRON_RUN_AS_NODE:'1'});assert.equal(env.ELECTRON_RUN_AS_NODE,undefined);
 assert.equal(downloaderEnvironment({env,electron:null}),env);
});

test('runProcess forwards a child environment without changing the parent environment',async()=>{
 const marker='GO_STREAMS_RUNTIME_REGRESSION',previous=process.env[marker];
 const result=await runProcess(process.execPath,['-p',`process.env.${marker}`],{env:{...process.env,[marker]:'child-only'}});
 assert.equal(result.stdout.trim(),'child-only');assert.equal(process.env[marker],previous);
});

test('YouTube downloads launch the bundled JavaScript engine as Node in Electron',async t=>{
 electronHost(t);const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'downloader-runtime-')),store=new Store(directory);let invocation,child;
 const downloads=new Downloads({store},{spawnProcess:(command,args,options)=>{
  invocation={command,args,options};child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child;
 }});
 t.after(async()=>{if(downloads.active.size)child.emit('close',1);await downloads.shutdown();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 downloads.start({url:'https://youtu.be/abcdefghijk'});
 assert.equal(invocation.args[invocation.args.indexOf('--js-runtimes')+1],'node:'+process.execPath);
 assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE,'1');assert.notEqual(invocation.options.env,process.env);
 child.emit('close',1);await downloads.shutdown();
});

test('YouTube downloads preserve a configured FFmpeg executable with a custom filename',async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'downloader-custom-tool-')),store=new Store(directory);
 const tool=path.join(directory,'Custom tools','ffmpeg-custom.exe');fs.mkdirSync(path.dirname(tool));fs.writeFileSync(tool,'controlled executable fixture');
 store.update(s=>{s.settings.ffmpeg=tool;});let invocation,child;
 const downloads=new Downloads({store},{spawnProcess:(command,args)=>{
  invocation={command,args};child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child;
 }});
 t.after(async()=>{if(downloads.active.size)child.emit('close',1);await downloads.shutdown();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 downloads.start({url:'https://youtu.be/abcdefghijk'});
 const location=invocation.args[invocation.args.indexOf('--ffmpeg-location')+1];
 assert.equal(location,tool,'yt-dlp must receive the selected executable, including its custom filename');
 assert.ok(fs.statSync(location).isFile());
 child.emit('close',1);await downloads.shutdown();
});

test('online YouTube source resolution carries Node mode into the downloader subprocess',async t=>{
 electronHost(t);let invocation;
 const sources=new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute:async(command,args,options)=>{
  invocation={command,args,options};return {stdout:JSON.stringify({protocol:'https',ext:'mp4',duration:3,url:'https://r.googlevideo.com/controlled'})};
 }});t.after(()=>sources.shutdown());
 await sources.resolve(sources.entry({path:'https://youtu.be/abcdefghijk'}));
 assert.equal(invocation.args[invocation.args.indexOf('--js-runtimes')+1],'node:'+process.execPath);
 assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE,'1');assert.notEqual(invocation.options.env,process.env);
});
