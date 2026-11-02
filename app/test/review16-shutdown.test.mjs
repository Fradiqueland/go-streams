import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {shutdownCoordinator,prepareRendererClose,cancelRendererClose}=createRequire(import.meta.url)('../electron/window-policy.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function backend(){return {studio:{jobs:new Map(),pendingImports:new Set(),pendingPreparations:new Set(),pendingOperations:new Set()},downloads:{active:new Map()},recordings:{active:new Map(),finalizing:new Map()},feeds:{active:new Map()},server:{listening:true},close:async()=>{}};}
test('native quit drains the final renderer chunk before closing backend and coalesces requests',async()=>{
 const b=backend(),gate=deferred(),events=[];b.recordings.active.set('recording',{});b.close=async()=>events.push('backend');
 const quit=shutdownCoordinator({backend:b,confirm:async()=>{events.push('confirm');return true;},prepare:async()=>{events.push('drain');await gate.promise;events.push('final chunk');},finish:async()=>events.push('window')});
 const first=quit(),second=quit();assert.equal(first,second);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['confirm','drain']);gate.resolve();assert.equal(await first,true);assert.deepEqual(events,['confirm','drain','final chunk','backend','window']);await quit();assert.equal(events.length,5);
});
test('cancelled native close leaves renderer, backend and window untouched and can retry',async()=>{
 const b=backend(),events=[];b.recordings.active.set('recording',{});let accepted=false;b.close=async()=>events.push('backend');
 const quit=shutdownCoordinator({backend:b,confirm:async()=>accepted,prepare:async()=>events.push('prepare'),finish:async()=>events.push('finish')});
 assert.equal(await quit(),false);assert.deepEqual(events,[]);accepted=true;assert.equal(await quit(),true);assert.deepEqual(events,['prepare','backend','finish']);
});
test('renderer drain failure retains the backend and window, cancels UI freeze and allows retry',async()=>{
 const b=backend(),events=[];let broken=true;b.close=async()=>events.push('backend');
 const quit=shutdownCoordinator({backend:b,confirm:async()=>true,prepare:async()=>{events.push('prepare');if(broken)throw Error('final chunk failed');},cancel:async()=>events.push('unfreeze'),finish:async()=>events.push('finish')});
 await assert.rejects(quit(),/final chunk failed/);assert.deepEqual(events,['prepare','unfreeze']);broken=false;await quit();assert.deepEqual(events,['prepare','unfreeze','prepare','backend','finish']);
});
test('backend close rejection keeps window open and retries a backend that remains listening',async()=>{
 const b=backend(),events=[];let broken=true;b.close=async()=>{events.push('backend');if(broken)throw Error('backend busy');};
 const quit=shutdownCoordinator({backend:b,confirm:async()=>true,prepare:async()=>events.push('prepare'),cancel:async()=>events.push('unfreeze'),finish:async()=>events.push('finish')});
 await assert.rejects(quit(),/backend busy/);assert.deepEqual(events,['prepare','backend','unfreeze']);broken=false;await quit();assert.deepEqual(events,['prepare','backend','unfreeze','prepare','backend','finish']);
});
test('partially closed backend failure remains visible and retry finishes without repeating cached close failure',async()=>{
 const b=backend(),events=[];b.close=async()=>{events.push('backend');b.server.listening=false;throw Error('service shutdown failed');};
 const quit=shutdownCoordinator({backend:b,confirm:async()=>true,prepare:async()=>events.push('prepare'),cancel:async()=>events.push('unfreeze'),finish:async()=>events.push('finish')});
 await assert.rejects(quit(),/service shutdown failed/);assert.deepEqual(events,['prepare','backend','unfreeze']);assert.equal(await quit(),true);assert.deepEqual(events,['prepare','backend','unfreeze','finish']);
});
test('window finish failure can retry without closing backend twice and preserves the original error',async()=>{
 const b=backend(),events=[];let broken=true;b.close=async()=>events.push('backend');
 const quit=shutdownCoordinator({backend:b,confirm:async()=>true,cancel:async()=>{throw Error('cancel failed');},finish:async()=>{events.push('finish');if(broken)throw Error('finish failed');}});
 await assert.rejects(quit(),/finish failed/);broken=false;await quit();assert.deepEqual(events,['backend','finish','finish']);
});
test('available renderer drain runs even before recording has reached the backend',async()=>{
 const calls=[],contents={isDestroyed:()=>false,getURL:()=> 'http://127.0.0.1:4317/?launch=token',executeJavaScript:async script=>{calls.push(script);return true;}};
 await prepareRendererClose(contents,{base:'http://127.0.0.1:4317'});assert.match(calls[0],/await window.GoStreamsPrepareClose/);await cancelRendererClose(contents,{base:'http://127.0.0.1:4317'});assert.match(calls[1],/GoStreamsCancelClose/);
});
test('missing startup hook is safe only without active work; hook rejection is never swallowed',async()=>{
 const contents={isDestroyed:()=>false,getURL:()=> 'http://127.0.0.1:4317/',executeJavaScript:async()=>false},options={base:'http://127.0.0.1:4317'};
 await prepareRendererClose(contents,options);await assert.rejects(prepareRendererClose(contents,{...options,required:true}),/still starting/);contents.executeJavaScript=async()=>{throw Error('recording could not save');};await assert.rejects(prepareRendererClose(contents,options),/could not save/);
});
test('untrusted, destroyed or crashed renderers receive no code and cannot silently discard active media',async()=>{
 for(const kind of ['untrusted','destroyed','crashed']){
  const contents={isDestroyed:()=>kind==='destroyed',getURL:()=>kind==='untrusted'?'https://example.org/':'http://127.0.0.1:4317/',executeJavaScript:()=>assert.fail('must not execute')},options={base:'http://127.0.0.1:4317',unavailable:kind==='crashed'};
  await prepareRendererClose(contents,options);await assert.rejects(prepareRendererClose(contents,{...options,required:true}),/unavailable/);await cancelRendererClose(contents,options);
 }
});
