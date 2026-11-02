import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness} from './ui-harness.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function attach(h,name,panel){h.context.fixture=panel;h.run(name+'=fixture');}

test('native close coalesces and locks inputs until both renderer panels finish',async()=>{
 const h=uiHarness(),live=deferred(),local=deferred(),calls=[];
 attach(h,'capturePanel',{busy:true,async release(options){calls.push(['live',options.throwOnError]);await live.promise;}});
 attach(h,'recorderPanel',{busy:true,async release(){calls.push(['recorder']);await local.promise;}});
 h.element('#dialog').inert=true;
 const first=h.context.window.GoStreamsPrepareClose(),second=h.context.window.GoStreamsPrepareClose();
 assert.equal(first,second);assert.equal(h.element('body').inert,true);assert.equal(h.element('#exit').disabled,true);assert.equal(h.run('interfaceClosing'),true);
 await turn();assert.deepEqual(calls,[['live',true],['recorder']]);assert.equal(h.requests.length,0);
 let finished=false;first.then(()=>{finished=true;});live.resolve();await turn();assert.equal(finished,false);local.resolve();await first;
 assert.equal(h.element('body').inert,true);assert.equal(h.run('interfaceClosing'),true);assert.equal(h.requests.length,0);
 h.context.window.GoStreamsCancelClose();assert.equal(Boolean(h.element('body').inert),false);assert.equal(h.element('#dialog').inert,true);assert.equal(h.element('#exit').disabled,false);assert.equal(h.run('interfaceClosing'),false);
});

test('a close failure waits for sibling drainage, restores input and permits a fresh retry',async()=>{
 const h=uiHarness(),local=deferred(),failure=Error('Final upload failed');let attempts=0;
 attach(h,'capturePanel',{busy:true,async release(){if(++attempts===1)throw failure;}});
 attach(h,'recorderPanel',{busy:true,async release(){await local.promise;}});
 const closing=h.context.window.GoStreamsPrepareClose(),rejected=assert.rejects(closing,error=>error===failure);
 await turn();assert.equal(h.element('body').inert,true);local.resolve();await rejected;
 assert.equal(Boolean(h.element('body').inert),false);assert.equal(h.element('#exit').disabled,false);assert.equal(h.run('interfaceClosing'),false);
 await h.context.window.GoStreamsPrepareClose();assert.equal(attempts,2);assert.equal(h.element('body').inert,true);
});

test('a recording that remains active after release prevents native backend shutdown',async()=>{
 const h=uiHarness({locale:'en'}),production={recording:true};let attempts=0;
 attach(h,'capturePanel',{busy:true,production,async release(){this.busy=false;if(++attempts>1)production.recording=false;}});
 await assert.rejects(h.context.window.GoStreamsPrepareClose(),/could not finish/);
 assert.equal(h.requests.length,0);assert.equal(Boolean(h.element('body').inert),false);assert.equal(h.element('#exit').disabled,false);
 await h.context.window.GoStreamsPrepareClose();assert.equal(attempts,2);assert.equal(h.element('body').inert,true);
});

test('closing through Exit awaits the final upload before calling backend shutdown',async()=>{
 const h=uiHarness(),finalUpload=deferred();let released=false;
 attach(h,'recorderPanel',{busy:true,async release(){await finalUpload.promise;released=true;}});
 const exiting=h.element('#exit').onclick();await turn();assert.equal(released,false);assert.equal(h.requests.length,0);
 finalUpload.resolve();await exiting;assert.equal(released,true);assert.deepEqual(h.requests.map(request=>request.url),['/api/shutdown']);assert.equal(h.element('body').inert,true);
});

test('a failed backend shutdown unlocks the renderer and Exit retries its preparation',async()=>{
 let requests=0,releases=0;const h=uiHarness({fetch:async()=>({ok:++requests>1,json:async()=>({error:'Backend is busy'})})});
 attach(h,'recorderPanel',{busy:true,async release(){releases++;}});
 await h.element('#exit').onclick();assert.equal(Boolean(h.element('body').inert),false);assert.equal(h.element('#exit').disabled,false);assert.equal(h.run('interfaceClosing'),false);
 await h.element('#exit').onclick();assert.equal(releases,2);assert.equal(requests,2);assert.equal(h.element('body').inert,true);
});

test('a pending refresh cannot replace the renderer while native closure drains',async()=>{
 const response=deferred(),drain=deferred(),h=uiHarness({fetch:async()=>{await response.promise;return {ok:true,json:async()=>({media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}})};}});
 attach(h,'recorderPanel',{busy:true,async release(){await drain.promise;}});
 h.element('#content').innerHTML='Current recording';const refreshing=h.run('refresh()'),closing=h.context.window.GoStreamsPrepareClose();
 response.resolve();await refreshing;assert.equal(h.element('#content').innerHTML,'Current recording');drain.resolve();await closing;
});

test('Exit cancellation leaves inputs available without draining or calling shutdown',async()=>{
 const h=uiHarness({confirm:false});let releases=0;attach(h,'recorderPanel',{busy:true,async release(){releases++;}});
 await h.element('#exit').onclick();assert.equal(releases,0);assert.equal(h.requests.length,0);assert.equal(Boolean(h.element('body').inert),false);assert.equal(h.run('interfaceClosing'),false);
});

for(const fail of [false,true])test('Exit during initial state loading keeps the closing screen after startup '+(fail?'fails':'succeeds'),async()=>{
 const initial=deferred(),h=uiHarness({startup:true,locale:'en',fetch:async url=>{
  if(url==='/api/state'){await initial.promise;return {ok:true,json:async()=>({media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}})};}
  return {ok:true,json:async()=>({ok:true})};
 }});
 await h.element('#exit').onclick();const closing=h.element('#content').innerHTML;
 assert.equal(h.run('interfaceClosing'),true);assert.equal(h.element('#exit').disabled,true);assert.equal(h.run('poll'),null);
 if(fail)initial.reject(Error('Startup connection closed'));else initial.resolve();await h.startup;
 assert.equal(h.element('#content').innerHTML,closing);assert.equal(h.run('poll'),null);assert.deepEqual(h.requests.map(request=>request.url),['/api/state','/api/shutdown']);
});

test('health arriving after Exit cannot update the closing interface or start polling',async()=>{
 const initial=deferred(),h=uiHarness({startup:true,fetch:async url=>{
  if(url==='/api/health'){await initial.promise;return {ok:true,json:async()=>({version:'9.9.9',tools:{}})};}
  return {ok:true,json:async()=>({media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}})};
 }});
 await turn();assert.deepEqual(h.requests.map(request=>request.url),['/api/state','/api/health']);
 await h.element('#exit').onclick();const closing=h.element('#content').innerHTML;initial.resolve();await h.startup;
 assert.equal(h.element('#content').innerHTML,closing);assert.equal(h.element('.version').textContent,'');assert.equal(h.run('poll'),null);assert.equal(h.run('interfaceClosing'),true);
});

test('failed Exit after startup finishes under the close lock restores readiness and exactly one refresh timer',async()=>{
 const initial=deferred(),shutdown=deferred(),h=uiHarness({startup:true,locale:'en',fetch:async url=>{
  if(url==='/api/shutdown'){await shutdown.promise;return {ok:false,json:async()=>({error:'Shutdown is unavailable'})};}
  if(url==='/api/health')return {ok:true,json:async()=>({version:'9.8.7',tools:{}})};
  await initial.promise;return {ok:true,json:async()=>({media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}})};
 }});
 const exiting=h.element('#exit').onclick();await turn();initial.resolve();await h.startup;
 assert.equal(h.run('poll'),null);assert.equal(h.run('startupDeferred'),true);const timers=h.intervals.length;
 shutdown.resolve();await exiting;await turn();
 assert.equal(h.run('interfaceClosing'),false);assert.equal(h.run('startupDeferred'),false);assert.equal(h.element('.version').textContent,'v9.8.7');assert.match(h.element('#content').innerHTML,/Overview/);
 assert.equal(h.intervals.length,timers+1);const poll=h.run('poll');h.context.window.GoStreamsCancelClose();assert.equal(h.run('poll'),poll);assert.equal(h.intervals.length,timers+1);
 const before=h.requests.filter(request=>request.url==='/api/state').length;await h.intervals[poll-1]();assert.equal(h.requests.filter(request=>request.url==='/api/state').length,before+1);
});
