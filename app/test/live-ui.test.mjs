import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveCapturePanel} from '../public/live-capture.js';
import {ProductionTools} from '../public/live-production.js';
import {ChatPanel} from '../public/unified-chat.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function capturePanel(api){
 const panel=new LiveCapturePanel({api,toast(){},getState(){return {};}});
 panel.controls=()=>{};panel.status=(value,error=false)=>{panel.lastStatus={value,error};};
 panel.element={querySelector:()=>({checked:true})};return panel;
}
function installRecorder(t){
 const previous=globalThis.MediaRecorder;
 globalThis.MediaRecorder=class extends EventTarget{
  static isTypeSupported(){return true;}
  state='inactive';start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>this.dispatchEvent(new Event('stop')));}
 };
 t.after(()=>{if(previous===undefined)delete globalThis.MediaRecorder;else globalThis.MediaRecorder=previous;});
}

test('failed live stop releases its capture role and keeps the session available to retry',async()=>{
 let fail=true;const released=[];const panel=capturePanel(async()=>{if(fail)throw Error('offline');});
 panel.session={id:'live-session'};panel.releaseFeed=async role=>released.push(role);
 await panel.stop();assert.deepEqual(released,['live']);assert.equal(panel.session.id,'live-session');assert.equal(panel.lastStatus.error,true);assert.equal(panel.stopping,false);
 fail=false;await panel.stop();assert.equal(panel.session,null);assert.equal(panel.lastStatus.error,false);
});

test('an idle capture panel does not display unrelated prerecorded jobs as live destinations',()=>{
 const panel=capturePanel(async()=>{}),destinations={},results={};panel.element={querySelectorAll:()=>[],querySelector:selector=>selector==='.capture-results'?results:destinations};
 panel.update({channels:[],recordings:[],jobs:[{id:'prerecorded',channelName:'Prerecorded channel',status:'running'}]});assert.equal(results.innerHTML,'');
});

test('a new recording waits for the previous shared feed to close before acquiring another',async t=>{
 installRecorder(t);const closed=deferred(),calls=[];const panel=capturePanel(async route=>{calls.push(route);return {id:'new-feed'};});
 panel.output={};panel.config={quality:'720p'};panel.feedSession={id:'old-feed'};
 panel.feedClosing=closed.promise.then(()=>{panel.feedSession=null;panel.feedClosing=null;});
 const acquiring=panel.acquireFeed('recording');await Promise.resolve();assert.deepEqual(calls,[]);
 closed.resolve();assert.equal(await acquiring,'new-feed');assert.deepEqual(calls,['/api/capture/start']);assert.deepEqual([...panel.feedUsers],['recording']);
 await panel.releaseFeed('recording');assert.equal(panel.feedSession,null);
});

test('concurrent live and recording startup failures remove both shared-feed reservations',async t=>{
 installRecorder(t);const started=deferred();const panel=capturePanel(()=>started.promise);panel.output={};panel.config={quality:'720p'};
 const live=panel.acquireFeed('live'),recording=panel.acquireFeed('recording');started.reject(Error('encoder unavailable'));
 const result=await Promise.allSettled([live,recording]);assert.ok(result.every(r=>r.status==='rejected'));assert.equal(panel.feedUsers.size,0);assert.equal(panel.feedStarting,null);assert.equal(panel.feedSession,null);
});

test('adjusting volumes during a clip keeps live audio muted and restores the selected level afterwards',()=>{
 const panel=capturePanel(async()=>{}),gain={gain:{value:1}};let disconnected=false;
 panel.audioInputs=[{name:'micVolume',gain}];panel.clipAudio={disconnect(){disconnected=true;}};
 panel.production={element:{querySelector:()=>({value:'0.45'})}};
 panel.setInputVolume('micVolume',.45);assert.equal(gain.gain.value,0);
 panel.setClipAudio(null);assert.equal(gain.gain.value,.45);assert.equal(disconnected,true);
});

test('chat send locks the draft and reply destination while a provider response is pending',async()=>{
 const panel=new ChatPanel({api(){},toast(){},onFeature(){}});
 const controls={'.chat-compose select':{value:'room-a'},'.chat-compose button':{},'.chat-compose textarea':{},'[data-chat="cancel-reply"]':{},'.chat-reply-target':{}};
 const replyButton={};panel.element={querySelector:selector=>controls[selector],querySelectorAll:()=>[replyButton]};panel.snapshot={connections:[{id:'room-a',status:'connected',platform:'Twitch'}],messages:[{id:'message',connectionId:'room-a',author:'Viewer',text:'Hello'}]};panel.replyTo='message';panel.sending=true;panel.updateComposer();
 assert.equal(controls['.chat-compose select'].disabled,true);assert.equal(controls['.chat-compose textarea'].disabled,true);assert.equal(controls['.chat-compose textarea'].maxLength,500);assert.equal(replyButton.disabled,true);
 await panel.action({dataset:{chat:'cancel-reply'}});assert.equal(panel.replyTo,'message');
 panel.sending=false;controls['.chat-compose select'].value='room-b';panel.updateComposer();assert.equal(panel.replyTo,null);assert.equal(controls['.chat-reply-target'].textContent,'');assert.equal(controls['.chat-compose textarea'].disabled,false);
});

test('removing branding clears file controls so the same image can be selected again',async()=>{
 const tools=new ProductionTools({getStream(){},toast(){}}),inputs={logo:{value:'C:/fakepath/logo.png'},backgroundImage:{value:'C:/fakepath/background.png'}};
 tools.values.logo='data:image/png;base64,old';tools.values.backgroundImage='data:image/png;base64,old';tools.images={logo:{},backgroundImage:{}};
 tools.element={querySelector:selector=>inputs[/name="([^"]+)"/.exec(selector)[1]]};tools.update=()=>{};
 await tools.action({dataset:{production:'clear-images'}});assert.equal(inputs.logo.value,'');assert.equal(inputs.backgroundImage.value,'');assert.deepEqual(tools.images,{});
});

test('clip audio initialization errors release the local video and object URL',async t=>{
 const previous=globalThis.document,errors=[];const video={pause(){this.paused=true;},play(){throw Error('must not play');}};
 globalThis.document={createElement:()=>video};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 const tools=new ProductionTools({getStream:()=>({}),toast:message=>errors.push(message),setClipAudio:source=>{if(source)throw Error('audio initialization failed');}});
 tools.element={querySelector:()=>({files:[new Blob(['synthetic'],{type:'video/mp4'})]})};tools.update=()=>{};
 await tools.action({dataset:{production:'play-clip'}});assert.equal(tools.clip,null);assert.equal(tools.clipUrl,null);assert.equal(video.paused,true);assert.deepEqual(errors,['audio initialization failed']);
});

test('backend-interrupted recordings unlock the record controls and preserve the recovery listing',async()=>{
 const released=[],tools=new ProductionTools({getStream:()=>({}),toast(){},releaseFeed:async role=>released.push(role)});
 const controls={'[data-production="record"]':{},'[data-production="stop-record"]':{},'.recording-status':{},'.recording-files':{}};
 tools.element={querySelector:selector=>controls[selector]};tools.recordingId='recording-id';
 const recordings=[{id:'recording-id',created:'2026-10-31T00:00:00Z',status:'interrupted',error:'Disk full',bytes:100}];tools.update(recordings);
 assert.equal(tools.recordingId,null);assert.equal(controls['[data-production="record"]'].disabled,false);assert.equal(controls['.recording-status'].textContent,'Disk full');assert.deepEqual(released,['recording']);
 const listing=controls['.recording-files'].innerHTML;assert.match(listing,/Recover local recording/);tools.update();assert.equal(controls['.recording-files'].innerHTML,listing);
});

test('tall logos retain their original aspect ratio within the program bounds',()=>{
 const tools=new ProductionTools({}),draws=[];tools.images.logo={width:50,height:200};
 const context={fillRect(){},drawImage(...args){draws.push(args);}};tools.draw(context,1000,600,null,null,()=>{});
 assert.equal(draws.length,1);const [,x,y,width,height]=draws[0];assert.equal(width/height,.25);assert.ok(width<=130&&height<=120&&x>=0&&y>=0);
});

test('invalid saved scene container data does not break future scene saves',t=>{
 const previous=globalThis.localStorage;globalThis.localStorage={getItem:()=> 'null'};t.after(()=>{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});
 const tools=new ProductionTools({});assert.deepEqual(tools.scenes,{});tools.scenes.intro={name:'Presenter'};assert.equal(tools.scenes.intro.name,'Presenter');
});

test('recording finalization failures keep the active recording available for a retry',async()=>{
 let fail=true;const released=[],tools=new ProductionTools({api:async()=>{if(fail)throw Error('offline');},toast(){},releaseFeed:async role=>released.push(role)});
 const status={};tools.element={querySelector:()=>status};tools.update=()=>{};tools.recordingId='active-recording';
 await tools.stopRecording();assert.equal(tools.recordingId,'active-recording');assert.deepEqual(released,[]);assert.equal(status.textContent,'offline');assert.equal(tools.finishing,null);
 fail=false;await tools.stopRecording();assert.equal(tools.recordingId,null);assert.deepEqual(released,['recording']);assert.match(status.textContent,/saved locally/);
});
