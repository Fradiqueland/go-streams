import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveCapturePanel} from '../public/live-capture.js';
import {ProductionTools} from '../public/live-production.js';
import {ChatPanel} from '../public/unified-chat.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function replaceGlobal(t,name,value){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}
function previewEnvironment(t,source,mediaDevices){
 class Track extends EventTarget{constructor(kind='video'){super();this.kind=kind;this.readyState='live';}stop(){this.stopped=true;this.readyState='ended';}}
 class Stream{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}}
 const node=()=>({gain:{value:1},connect(target){return target;},disconnect(){},start(){}});
 replaceGlobal(t,'navigator',{mediaDevices});replaceGlobal(t,'window',{MediaRecorder:{}});replaceGlobal(t,'MediaStream',Stream);
 replaceGlobal(t,'FormData',class{get(name){return {source,quality:'720p',aspect:'16:9'}[name]||'';}has(){return true;}});
 replaceGlobal(t,'document',{createElement:tag=>tag==='video'?{videoWidth:640,videoHeight:360,async play(){},pause(){}}:{getContext:()=>({}),captureStream:()=>new Stream([new Track()])}});
 replaceGlobal(t,'AudioContext',class{destination=node();async resume(){}async close(){}createMediaStreamDestination(){return {stream:new Stream([new Track('audio')])};}createGain(){return node();}createAnalyser(){return {...node(),fftSize:32};}createOscillator(){return node();}createMediaStreamSource(){return node();}});
 replaceGlobal(t,'setInterval',()=>1);replaceGlobal(t,'clearInterval',()=>{});
 const panel=capturePanel(async()=>{});panel.production={draw(){},update(){},element:{querySelector:()=>({value:'1'})},async stopRecording(){},stopClip(){}};panel.listDevices=async()=>{};
 return {panel,Track,Stream};
}
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

test('permission results arriving after device release cannot revive a cancelled preview',async t=>{
 const pending=deferred(),{panel,Track,Stream}=previewEnvironment(t,'camera',{getUserMedia:()=>pending.promise}),track=new Track(),stream=new Stream([track]);
 const preview=panel.preview();panel.releaseDevices();pending.resolve(stream);await preview;
 assert.equal(track.stopped,true);assert.equal(panel.output,null);assert.equal(panel.streams.length,0);assert.equal(panel.preparing,false);
});

test('ending screen sharing during microphone permission cancels the pending camera acquisition',async t=>{
 const pending=deferred();let screen;const {panel,Track,Stream}=previewEnvironment(t,'screen-camera',{getDisplayMedia:async()=>screen,getUserMedia:()=>pending.promise});
 const screenTrack=new Track(),cameraTrack=new Track(),camera=new Stream([cameraTrack]);screen=new Stream([screenTrack]);
 const preview=panel.preview();await new Promise(resolve=>setImmediate(resolve));
 screenTrack.readyState='ended';screenTrack.dispatchEvent(new Event('ended'));pending.resolve(camera);await preview;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(screenTrack.stopped,true);assert.equal(cameraTrack.stopped,true);assert.equal(panel.output,null);assert.equal(panel.streams.length,0);
});

test('a live start response arriving after preview release is stopped instead of reviving a broadcast',async()=>{
 const pending=deferred(),calls=[],panel=capturePanel(async route=>{calls.push(route);if(route==='/api/live/start')return pending.promise;return {ok:true};});
 panel.output={getTracks:()=>[]};panel.config={source:'camera',quality:'720p',aspect:'16:9'};panel.acquireFeed=async()=> 'shared-feed';panel.releaseFeed=async()=>{};
 panel.element.querySelectorAll=()=>[{value:'destination'}];
 const starting=panel.start();await new Promise(resolve=>setImmediate(resolve));await panel.release();pending.resolve({id:'late-session'});await starting;
 assert.ok(calls.includes('/api/live/late-session/stop'));assert.equal(panel.session,null);assert.equal(panel.output,null);assert.equal(panel.preparing,false);
});

test('chat origin labels rerender when a destination is renamed without replacing its messages',()=>{
 const panel=new ChatPanel({}),log={scrollHeight:10,scrollTop:0,clientHeight:10};
 panel.element={querySelector:selector=>selector==='.chat-messages'?log:{value:''}};
 const message={id:'retained',connectionId:'room',platform:'YouTube',channelName:'Old channel',author:'Viewer',text:'Hello'};
 panel.snapshot={messages:[message]};panel.renderMessages();assert.match(log.innerHTML,/Old channel/);
 message.channelName='New channel';panel.renderMessages();assert.match(log.innerHTML,/New channel/);assert.doesNotMatch(log.innerHTML,/Old channel/);
});

test('clearing branding cancels an image decode already in flight',async t=>{
 const decoded=deferred();replaceGlobal(t,'FileReader',class{readAsDataURL(){this.result='data:image/png;base64,synthetic';this.onload();}});
 replaceGlobal(t,'Image',class{width=20;height=20;decode(){return decoded.promise;}});
 replaceGlobal(t,'document',{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/png;base64,resized'})});
 const tools=new ProductionTools({toast(){}});tools.element={querySelector:()=>({value:'selected.png'})};tools.update=()=>{};
 const loading=tools.loadImage('logo',{type:'image/png',size:20});await Promise.resolve();await tools.action({dataset:{production:'clear-images'}});decoded.resolve();await loading;
 assert.equal(tools.values.logo,'');assert.deepEqual(tools.images,{});
});

test('chat explains Twitch Shared Chat platform forwarding before sending',t=>{
 let section;replaceGlobal(t,'document',{createElement:()=>section={addEventListener(){}}});
 const panel=new ChatPanel({});panel.update=()=>{};panel.mount({appendChild(){}},{},[]);
 assert.match(section.innerHTML,/Shared Chat/);
});

test('scene image decoding cannot restore images after branding is cleared',async t=>{
 const decoded=deferred();replaceGlobal(t,'Image',class{decode(){return decoded.promise;}});
 const tools=new ProductionTools({toast(){}});tools.scenes.intro={logo:'data:image/png;base64,scene'};tools.update=()=>{};
 tools.element={querySelector:selector=>selector==='[name=scene]'?{value:'intro'}:{type:'file',value:''}};
 const loading=tools.action({dataset:{production:'load-scene'}});await Promise.resolve();await tools.action({dataset:{production:'clear-images'}});decoded.resolve();await loading;
 assert.equal(tools.values.logo,'');assert.deepEqual(tools.images,{});
});

test('replying to disconnected history leaves the active destination intact and explains the unavailable chat',async()=>{
 const errors=[],panel=new ChatPanel({toast:message=>errors.push(message)}),selector={value:'active'},oldButton={dataset:{id:'old'}},activeButton={dataset:{id:'new'}};
 const controls={'.chat-compose select':selector,'.chat-compose button':{},'.chat-compose textarea':{},'[data-chat="cancel-reply"]':{},'.chat-reply-target':{}};
 panel.element={querySelector:selector=>controls[selector],querySelectorAll:()=>[oldButton,activeButton]};
 panel.snapshot={connections:[{id:'active',status:'connected',platform:'YouTube'}],messages:[{id:'old',connectionId:'disconnected'},{id:'new',connectionId:'active'}]};
 panel.updateComposer();assert.equal(oldButton.disabled,true);assert.equal(activeButton.disabled,false);
 await panel.action({dataset:{chat:'reply',id:'old'}});assert.equal(selector.value,'active');assert.equal(panel.replyTo,null);assert.match(errors[0],/Connect this chat/);
});

for(const status of ['connecting','connected','error'])test('chat connection feedback reflects the returned '+status+' status',async t=>{
 replaceGlobal(t,'FormData',class{get(name){return {channelId:'room',resource:'channel'}[name];}has(){return true;}});
 const notices=[],button={},response={accounts:{},connections:[{id:'room',channelId:'room',status,error:status==='error'?'Platform unavailable':''}],messages:[]};
 const panel=new ChatPanel({api:async()=>response,toast:(message,error=false)=>notices.push({message,error})});panel.update=state=>{panel.snapshot=state;};panel.updateComposer=()=>{};
 const form={classList:{contains:value=>value==='chat-connect'},querySelector:()=>button};await panel.submit(form);
 assert.equal(notices.length,1);assert.equal(notices[0].error,status==='error');assert.equal(button.disabled,false);
 if(status==='connecting'){assert.match(notices[0].message,/requested.*Waiting/);assert.doesNotMatch(notices[0].message,/Chat connected\./);}
 if(status==='connected')assert.equal(notices[0].message,'Chat connected.');
 if(status==='error')assert.equal(notices[0].message,'Platform unavailable');
});

test('returning to live while a clip loads cancels playback without reporting an error',async t=>{
 const pending=deferred(),errors=[],audio=[],video={pause(){this.paused=true;},play:()=>pending.promise};
 replaceGlobal(t,'document',{createElement:()=>video});
 const tools=new ProductionTools({getStream:()=>({}),toast:message=>errors.push(message),setClipAudio:source=>audio.push(source)});
 tools.element={querySelector:()=>({files:[new Blob(['clip'],{type:'video/mp4'})]})};tools.update=()=>{};
 const playing=tools.action({dataset:{production:'play-clip'}});await tools.action({dataset:{production:'stop-clip'}});
 pending.reject(Error('The play() request was interrupted by a call to pause().'));await playing;
 assert.equal(tools.clip,null);assert.equal(tools.clipUrl,null);assert.equal(video.paused,true);assert.equal(audio.at(-1),null);assert.deepEqual(errors,[]);
});

test('a cancelled clip play rejection cannot stop a newer clip or report a playback error',async t=>{
 const first=deferred(),videos=[],errors=[],audio=[];
 replaceGlobal(t,'document',{createElement:()=>{const video={pause(){this.paused=true;},play(){return videos.length===1?first.promise:Promise.resolve();}};videos.push(video);return video;}});
 const tools=new ProductionTools({getStream:()=>({}),toast:message=>errors.push(message),setClipAudio:video=>audio.push(video)});
 tools.element={querySelector:()=>({files:[new Blob(['clip'],{type:'video/mp4'})]})};tools.update=()=>{};
 const playing=tools.action({dataset:{production:'play-clip'}});
 await tools.action({dataset:{production:'stop-clip'}});
 await tools.action({dataset:{production:'play-clip'}});const current=tools.clip;
 first.reject(Error('The play() request was interrupted by a call to pause().'));await playing;
 assert.equal(tools.clip,current);assert.equal(current.paused,undefined);assert.equal(audio.at(-1),current);assert.deepEqual(errors,[]);
 tools.stopClip();
});

test('losing the selected chat does not silently redirect an existing draft to another destination',t=>{
 replaceGlobal(t,'document',{activeElement:null});
 const panel=new ChatPanel({}),selector={value:'room-a'},draft={value:'For room A only'},controls={
  '.chat-accounts':{contains:()=>false},'.chat-connect select':{value:''},'.chat-compose select':selector,
  '[data-chat="filter"]':{value:''},'.chat-connection-status':{},'.chat-compose button':{},'.chat-compose textarea':draft,
  '[data-chat="cancel-reply"]':{},'.chat-reply-target':{},'.chat-messages':{scrollHeight:0,scrollTop:0,clientHeight:0}
 };
 panel.element={querySelector:name=>controls[name],querySelectorAll:()=>[]};
 const room=(id,status='connected')=>({id,name:id,status,platform:'Twitch'});
 panel.update({accounts:{},connections:[room('room-a'),room('room-b')],messages:[]},[]);
 panel.update({accounts:{},connections:[room('room-b')],messages:[]});
 assert.equal(selector.value,'');assert.equal(draft.value,'For room A only');assert.equal(controls['.chat-compose button'].disabled,true);
 panel.update({accounts:{},connections:[room('room-b'),room('room-c')],messages:[]});
 assert.equal(selector.value,'');assert.equal(controls['.chat-compose button'].disabled,true);
});

test('a scene save rejected by browser storage preserves the last successfully saved scene',async t=>{
 replaceGlobal(t,'localStorage',{getItem:()=>JSON.stringify({intro:{name:'Saved presenter'}}),setItem(){throw Error('Quota exceeded');}});
 const errors=[],tools=new ProductionTools({toast:message=>errors.push(message)});tools.update=()=>{};
 tools.element={querySelector:selector=>selector==='[name=scene]'?{value:'intro'}:{type:'text'}};
 tools.values.name='Unsaved replacement';await tools.action({dataset:{production:'save-scene'}});
 assert.equal(errors.length,1);assert.match(errors[0],/could not save/);
 await tools.action({dataset:{production:'load-scene'}});assert.equal(tools.values.name,'Saved presenter');
});

test('closing a preview prevents another recording from starting while live shutdown is pending',async t=>{
 const stopped=deferred(),calls=[],panel=capturePanel(async route=>{calls.push(route);if(route==='/api/live/active/stop')return stopped.promise;return {id:'unexpected-recording'};});
 panel.output={getTracks:()=>[]};panel.session={id:'active'};panel.acquireFeed=async()=> 'shared-feed';panel.releaseFeed=async()=>{};
 panel.update=()=>{};t.mock.method(ProductionTools.prototype,'mount',()=>{});panel.mount({appendChild(){}},{});
 panel.production.element={querySelector:()=>({})};panel.production.update=()=>{};
 const closing=panel.release();await new Promise(resolve=>setImmediate(resolve));
 try{await panel.production.startRecording();assert.equal(panel.production.recordingId,undefined);assert.deepEqual(calls,['/api/live/active/stop']);}
 finally{stopped.resolve();await closing;}
 assert.equal(panel.output,null);
});

test('loading a saved scene clears branding pickers so the previous file can be selected again',async()=>{
 const tools=new ProductionTools({toast(){}}),inputs={logo:{type:'file',value:'C:/fakepath/logo.png'},backgroundImage:{type:'file',value:'C:/fakepath/background.png'}};
 tools.scenes.intro={name:'Presenter'};tools.element={querySelector:selector=>selector==='[name=scene]'?{value:'intro'}:inputs[/name="([^"]+)"/.exec(selector)[1]]};tools.update=()=>{};
 await tools.action({dataset:{production:'load-scene'}});assert.equal(inputs.logo.value,'');assert.equal(inputs.backgroundImage.value,'');
});

test('an upload failure cancels a pending live start and stops its delayed session response',async t=>{
 installRecorder(t);const started=deferred(),calls=[],panel=capturePanel(async route=>{calls.push(route);if(route==='/api/live/start')return started.promise;return {id:'shared-feed'};});
 panel.output={getTracks:()=>[]};panel.config={quality:'720p'};panel.production={async stopRecording(){}};panel.element.querySelectorAll=()=>[{value:'destination'}];
 const starting=panel.start();await new Promise(resolve=>setImmediate(resolve));
 panel.feedUploader.fail(Error('Upload disconnected'));await new Promise(resolve=>setImmediate(resolve));
 started.resolve({id:'late-session'});await starting;
 assert.equal(panel.session,null);assert.ok(calls.includes('/api/live/late-session/stop'));assert.equal(panel.feedSession,null);
});
