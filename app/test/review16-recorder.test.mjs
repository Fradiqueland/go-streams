import test from 'node:test';
import assert from 'node:assert/strict';
import {RecorderPanel} from '../public/recorder.js';
import {ProductionTools} from '../public/live-production.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function replaceGlobal(t,name,value){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}
function productionFixture(t,{saved={},recordingControls=false}={}){
 const storage=new Map([['go-streams-scenes',JSON.stringify(saved)]]),nodes=new Map(),events=[],messages=[],volumes=[];let next=0;
 const node=key=>{if(nodes.has(key))return nodes.get(key);const value={value:'',checked:false,type:'',handlers:new Map(),innerHTML:'',textContent:'',appendChild(){},before(){},after(){},closest:()=>node(key+' label'),querySelector:selector=>node(selector),addEventListener(type,handler){this.handlers.set(type,handler);},get nextElementSibling(){return node(key+' next');},get parentElement(){return node(key+' parent');}};nodes.set(key,value);return value;};
 replaceGlobal(t,'localStorage',{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)});
 replaceGlobal(t,'document',{createElement:()=>node('created-'+next++)});replaceGlobal(t,'window',{addEventListener(){}});
 const tools=new ProductionTools({recordingControls,getStream:()=>null,toast:(message,error)=>messages.push({message,error}),setVolume:(name,value)=>volumes.push([name,value]),onChange:()=>events.push('change')});tools.mount(node('parent'));node('[name=scene]').value='intro';
 const input=(name,value)=>{const field=node('[name="'+name+'"]');field.name=name;field.value=value;tools.element.handlers.get('input')({target:field});};
 return {tools,storage,node,input,messages,volumes};
}

const settle=()=>new Promise(setImmediate);
function recordingFixture(t,{api,send,onStop,construct,start,getRecordingConfig}={}){
 const events=[],requests=[],recorders=[],messages=[],status={},stream={getTracks:()=>[{stop:()=>assert.fail('Stopping a recording must not stop the shared composition')}]};
 class Recorder extends EventTarget{
  static isTypeSupported(){return true;}
  constructor(input,options){super();construct?.();this.stream=input;this.options=options;this.state='inactive';this.stops=0;recorders.push(this);}
  start(interval){start?.();this.interval=interval;this.state='recording';}
  emit(type,data){const event=new Event(type);if(data)event.data=data;this.dispatchEvent(event);}
  stop(){this.stops++;this.state='inactive';events.push('browser-stop');if(onStop)onStop(this);else queueMicrotask(()=>{this.emit('dataavailable',new Blob(['final-tail']));this.emit('stop');});}
 }
 replaceGlobal(t,'MediaRecorder',Recorder);replaceGlobal(t,'fetch',async(route,options)=>{events.push('chunk:'+await options.body.text());return send?send(route,options):{ok:true};});
 const tools=new ProductionTools({getStream:()=>stream,getRecordingConfig,api:async(route,body)=>{requests.push({route,body});events.push(route);return api?api(route,body):{id:'take'};},toast:message=>messages.push(message)});
 tools.recordingOptions=()=>({directory:'/recordings',askEveryTime:false});tools.element={querySelector:()=>status};tools.update=()=>{};
 return {tools,events,requests,recorders,messages,status,stream};
}

test('local production stopping twice waits for the last browser event and its upload before finalizing once',async t=>{
 const sent=deferred(),f=recordingFixture(t,{onStop(){},send:()=>sent.promise});await f.tools.startRecording();const recorder=f.recorders[0],stopping=f.tools.stopRecording(),again=f.tools.stopRecording();
 assert.equal(recorder.stops,1);assert.equal(f.requests.length,1);recorder.emit('dataavailable',new Blob(['last captured frames']));await settle();assert.equal(f.requests.length,1);
 recorder.emit('stop');await settle();assert.equal(f.requests.length,1);sent.resolve({ok:true});await Promise.all([stopping,again]);
 assert.deepEqual(f.events,['/api/recordings/start','browser-stop','chunk:last captured frames','/api/recordings/take/finish']);assert.equal(f.tools.recordingId,null);assert.match(f.status.textContent,/saved locally/i);
});

test('a failed finalization can retry without stopping the recorder or uploading the tail twice',async t=>{
 let fail=true;const f=recordingFixture(t,{api:async route=>{if(route.endsWith('/finish')&&fail)throw Error('Disk unavailable');return {id:'take'};}});await f.tools.startRecording();await f.tools.stopRecording();
 assert.equal(f.status.textContent,'Disk unavailable');assert.equal(f.tools.recordingId,'take');assert.equal(f.recorders[0].stops,1);assert.deepEqual(f.messages,['Disk unavailable']);
 fail=false;await f.tools.stopRecording();assert.equal(f.tools.recordingId,null);assert.equal(f.recorders[0].stops,1);assert.equal(f.events.filter(event=>event.startsWith('chunk:')).length,1);assert.match(f.status.textContent,/saved locally/i);
});

for(const strictFirst of [false,true])test('strict '+(strictFirst?'then ordinary':'after ordinary')+' stop observes the same finalization error and permits a later successful retry',async t=>{
 const pending=deferred();let fail=true;const f=recordingFixture(t,{api:async route=>{if(route.endsWith('/finish')){await pending.promise;if(fail)throw Error('Finish offline');}return {id:'take'};}});await f.tools.startRecording();
 const first=f.tools.stopRecording({throwOnError:strictFirst}),second=f.tools.stopRecording({throwOnError:!strictFirst}),result=Promise.allSettled([first,second]);await settle();assert.equal(f.recorders[0].stops,1);assert.equal(f.requests.length,2);pending.resolve();const results=await result;
 assert.equal(results[strictFirst?0:1].status,'rejected');assert.equal(results[strictFirst?0:1].reason.message,'Finish offline');assert.equal(results[strictFirst?1:0].status,'fulfilled');assert.equal(f.status.textContent,'Finish offline');assert.deepEqual(f.messages,['Finish offline']);assert.equal(f.tools.recordingId,'take');
 fail=false;await f.tools.stopRecording({throwOnError:true});assert.equal(f.tools.recordingId,null);assert.equal(f.recorders[0].stops,1);assert.equal(f.requests.length,3);assert.match(f.status.textContent,/saved locally/i);
});

test('strict stop joining an automatic upload failure receives its error even after the recording id is cleared',async t=>{
 const f=recordingFixture(t,{onStop(){},send:async()=>({ok:false,json:async()=>({error:'Upload interrupted'})})});await f.tools.startRecording();const recorder=f.recorders[0];recorder.emit('dataavailable',new Blob(['unfinished recording']));await settle();assert.ok(f.tools.finishing);const strict=f.tools.stopRecording({throwOnError:true}),checked=assert.rejects(strict,/Upload interrupted/);
 recorder.emit('stop');await checked;assert.equal(f.tools.recordingId,null);assert.equal(f.status.textContent,'Upload interrupted');assert.deepEqual(f.messages,['Upload interrupted']);assert.equal(f.requests.length,2);
 await f.tools.stopRecording({throwOnError:true});assert.equal(f.requests.length,2);assert.equal(f.status.textContent,'Upload interrupted');
});

test('production recording reuses the exact composed output and selected capture codec without a capture-feed session',async t=>{
 const f=recordingFixture(t,{getRecordingConfig:()=>({mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:2500000,audioBitsPerSecond:128000})});await f.tools.startRecording();
 assert.equal(f.recorders[0].stream,f.stream);assert.deepEqual(f.recorders[0].options,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:2500000,audioBitsPerSecond:128000});assert.deepEqual(f.requests,[{route:'/api/recordings/start',body:{confirmed:true,directory:'/recordings',kind:'video',format:'mp4'}}]);await f.tools.stopRecording();
});

test('an inactive MediaRecorder error still drains its final data and stop events before preserving the error',async t=>{
 const f=recordingFixture(t);await f.tools.startRecording();const recorder=f.recorders[0];recorder.state='inactive';recorder.emit('error');await settle();assert.equal(f.requests.length,1);assert.equal(recorder.stops,0);
 recorder.emit('dataavailable',new Blob(['salvaged ending']));recorder.emit('stop');await f.tools.finishing;
 assert.deepEqual(f.events,['/api/recordings/start','chunk:salvaged ending','/api/recordings/take/finish']);assert.equal(f.tools.recordingId,null);assert.match(f.status.textContent,/stopped unexpectedly/);assert.equal(f.messages.length,1);
});

test('a native stop without an error finalizes production recording after its pending last upload',async t=>{
 const sent=deferred(),f=recordingFixture(t,{send:()=>sent.promise});await f.tools.startRecording();const recorder=f.recorders[0];recorder.state='inactive';recorder.emit('dataavailable',new Blob(['natural ending']));recorder.emit('stop');await settle();
 assert.equal(f.requests.length,1);assert.ok(f.tools.finishing);assert.equal(recorder.stops,0);sent.resolve({ok:true});await f.tools.finishing;
 assert.deepEqual(f.events,['/api/recordings/start','chunk:natural ending','/api/recordings/take/finish']);assert.equal(f.tools.recording,false);assert.match(f.status.textContent,/saved locally/i);
});

test('a delayed old recorder stop cannot finalize a replacement production recording',async t=>{
 let next=0;const f=recordingFixture(t,{onStop(){},api:async route=>route.endsWith('/start')?{id:'take-'+(++next)}:{}});await f.tools.startRecording();const old=f.recorders[0];f.tools.update=ProductionTools.prototype.update;
 f.tools.update([{id:'take-1',created:'2026-11-02T00:00:00Z',status:'interrupted',error:'Old disk error',bytes:1}]);f.tools.update=()=>{};await f.tools.startRecording();old.emit('dataavailable',new Blob(['obsolete']));old.emit('stop');await settle();
 assert.equal(f.tools.recordingId,'take-2');assert.equal(f.recorders[1].state,'recording');assert.equal(f.requests.length,2);assert.equal(f.messages.length,0);const stopping=f.tools.stopRecording();f.recorders[1].emit('stop');await stopping;
});

test('a native stop also saves the dedicated recorder and clears its elapsed timer after the last upload',async t=>{
 const sent=deferred(),f=recordingFixture(t,{send:()=>sent.promise}),calls=[],fields=new Map(),statuses=[],cleared=[];replaceGlobal(t,'setInterval',()=>27);replaceGlobal(t,'clearInterval',id=>cleared.push(id));
 const panel=new RecorderPanel({api:async route=>{calls.push(route);return route.endsWith('/start')?{id:'dedicated'}:{};},toast:assert.fail});panel.$=selector=>{if(!fields.has(selector))fields.set(selector,{});return fields.get(selector);};panel.$('[name="directory"]').value='/recordings';panel.$('[name="askFolder"]').checked=false;panel.output=f.stream;panel.config={mode:'screen',countdown:0};panel.controls=()=>{};panel.status=value=>statuses.push(value);panel.update=()=>{};
 await panel.start();const recorder=f.recorders[0];recorder.state='inactive';recorder.emit('dataavailable',new Blob(['dedicated ending']));recorder.emit('stop');await settle();assert.equal(calls.length,1);assert.equal(panel.finishing,true);assert.ok(cleared.includes(27));sent.resolve({ok:true});await panel.stopDone;
 assert.deepEqual(calls,['/api/recordings/start','/api/recordings/dedicated/finish','/api/state']);assert.equal(panel.id,null);assert.equal(panel.finishing,false);assert.match(statuses.at(-1),/saved locally/i);
});

test('an upload failure waits for browser stop and retains the error instead of prematurely finalizing the backend',async t=>{
 const f=recordingFixture(t,{onStop(){},send:async()=>({ok:false,json:async()=>({error:'Disk full'})})});await f.tools.startRecording();const recorder=f.recorders[0];recorder.emit('dataavailable',new Blob(['earlier chunk']));await settle();
 assert.equal(recorder.stops,1);assert.equal(f.requests.length,1);recorder.emit('dataavailable',new Blob(['cannot upload after disk failure']));recorder.emit('stop');await f.tools.finishing;
 assert.equal(f.requests.length,2);assert.equal(f.status.textContent,'Disk full');assert.equal(f.messages.length,1);assert.equal(f.events.filter(event=>event.startsWith('chunk:')).length,1);
});

test('cancelling while recording creation is pending discards the empty backend job without constructing a browser recorder',async t=>{
 const pending=deferred(),f=recordingFixture(t,{api:route=>route.endsWith('/start')?pending.promise:{}}),starting=f.tools.startRecording(),stopping=f.tools.stopRecording();pending.resolve({id:'cancelled'});await Promise.all([starting,stopping]);
 assert.deepEqual(f.requests,[{route:'/api/recordings/start',body:{confirmed:true,directory:'/recordings',kind:'video',format:'mp4'}},{route:'/api/recordings/cancelled/finish',body:{discardEmpty:true}}]);assert.equal(f.recorders.length,0);assert.equal(f.messages.length,0);assert.equal(f.tools.recording,false);
});

for(const phase of ['construct','start'])test('a browser '+phase+' failure discards the empty recording without waiting for an impossible stop event',async t=>{
 const f=recordingFixture(t,{[phase]:()=>{throw Error('Encoder unavailable');}});await f.tools.startRecording();assert.equal(f.tools.recordingId,null);assert.equal(f.tools.starting,false);assert.equal(f.requests.at(-1).body.discardEmpty,true);assert.deepEqual(f.messages,['Encoder unavailable']);assert.equal(f.recorders[0]?.stops||0,0);
});

test('discarding a changed preview can be retried as an empty recording after a failed cleanup request',async t=>{
 const pending=deferred();let fail=true;const f=recordingFixture(t,{api:route=>{if(route.endsWith('/start'))return pending.promise;if(fail)throw Error('Finish offline');return {};}}),starting=f.tools.startRecording();f.tools.getStream=()=>null;pending.resolve({id:'empty'});await starting;
 assert.equal(f.recorders.length,0);assert.equal(f.tools.recordingId,'empty');assert.equal(f.requests.length,2);assert.equal(f.requests.at(-1).body.discardEmpty,true);fail=false;await f.tools.stopRecording();assert.equal(f.requests.length,3);assert.equal(f.requests.at(-1).body.discardEmpty,true);assert.equal(f.tools.recordingId,null);
});

test('a saved recorder file remains confirmed when only refreshing its list fails',async()=>{
 const events=[],messages=[],statuses=[],panel=new RecorderPanel({api:async route=>{events.push(route);if(route==='/api/state')throw Error('Status temporarily unavailable');return {};},toast:(message,error)=>messages.push({message,error})});
 panel.id='saved-take';panel.controls=()=>{};panel.status=message=>statuses.push(message);await panel.stop();
 assert.deepEqual(events,['/api/recordings/saved-take/finish','/api/state']);assert.equal(panel.id,null);assert.equal(panel.finishing,false);assert.match(statuses.at(-1),/saved locally/i);assert.equal(messages.length,1);assert.match(messages[0].message,/saved.*list.*refreshed/i);assert.equal(messages[0].error,true);
});

for(const active of [false,true])test('confirmed recovery survives a list refresh failure'+(active?' without replacing an active recording status':''),async()=>{
 const events=[],messages=[],panel=new RecorderPanel({api:async route=>{events.push(route);if(route==='/api/state')throw Error('List unavailable');return {};},toast:(message,error)=>messages.push({message,error})});let status='Recording to current folder';
 panel.status=message=>{status=message;};if(active)panel.id='current-take';await panel.recover('older-take');
 assert.deepEqual(events,['/api/recordings/older-take/finish','/api/state']);assert.equal(status,active?'Recording to current folder':'Recording recovered.');assert.equal(panel.id,active?'current-take':undefined);assert.match(messages[0].message,/recovered.*list.*refreshed/i);assert.equal(messages[0].error,true);
});

test('private notes and both volume controls participate in local scene drafts and survive saving/loading',async t=>{
 const {tools,input,node,storage,volumes}=productionFixture(t),panel=new RecorderPanel({});panel.production=tools;
 assert.equal(panel.hasUnsavedChanges,false);input('notes','Private speaking notes\nNext topic');input('micVolume','0.35');input('screenVolume','1.2');
 assert.equal(panel.hasUnsavedChanges,true);assert.equal(node('.teleprompter').textContent,'Private speaking notes\nNext topic');assert.deepEqual(volumes,[['micVolume',.35],['screenVolume',1.2]]);
 await tools.action({dataset:{production:'save-scene'}});assert.equal(panel.hasUnsavedChanges,false);const saved=JSON.parse(storage.get('go-streams-scenes')).intro;assert.equal(saved.notes,'Private speaking notes\nNext topic');assert.equal(saved.micVolume,.35);assert.equal(saved.screenVolume,1.2);
 input('notes','Changed notes');input('micVolume','1');input('screenVolume','0');await tools.action({dataset:{production:'load-scene'}});
 assert.equal(panel.hasUnsavedChanges,false);assert.equal(node('[name="notes"]').value,saved.notes);assert.equal(node('.teleprompter').textContent,saved.notes);assert.equal(node('[name="micVolume"]').value,.35);assert.equal(node('[name="screenVolume"]').value,1.2);assert.deepEqual(volumes.slice(-2),[['micVolume',.35],['screenVolume',1.2]]);
});

test('legacy visual scenes restore compatible empty notes and default audio levels',async t=>{
 const {tools,input,node,volumes}=productionFixture(t,{saved:{intro:{banner:'Legacy banner',layout:'split'}}});input('notes','Draft');input('micVolume','0');input('screenVolume','1.5');await tools.action({dataset:{production:'load-scene'}});
 assert.equal(tools.values.banner,'Legacy banner');assert.equal(tools.values.layout,'split');assert.equal(node('.teleprompter').textContent,'');assert.equal(tools.values.notes,'');assert.deepEqual(volumes.slice(-2),[['micVolume',1],['screenVolume',1]]);assert.equal(tools.hasUnsavedChanges,false);
});

test('saved scene fields are bounded and normalized before they reach controls or audio gains',async t=>{
 const {tools,node,volumes}=productionFixture(t,{saved:{intro:{notes:'n'.repeat(30001),name:'n'.repeat(100),title:{html:'invalid'},ticker:'t'.repeat(501),banner:123,layout:'unknown',background:'red',accent:'#AABBCC',mirror:'true',micVolume:-2,screenVolume:8,logo:'https://untrusted.invalid/image.png',recordingDirectory:'/unexpected',unknown:'ignore'},main:[],outro:'invalid'}});
 await tools.action({dataset:{production:'load-scene'}});assert.equal(tools.values.notes.length,30000);assert.equal(tools.values.name.length,80);assert.equal(tools.values.ticker.length,500);assert.equal(tools.values.title,'');assert.equal(tools.values.banner,'');assert.equal(tools.values.layout,'pip');assert.equal(tools.values.background,'#111827');assert.equal(tools.values.accent,'#AABBCC');assert.equal(tools.values.mirror,false);assert.equal(tools.values.logo,'');assert.equal(tools.values.recordingDirectory,undefined);assert.equal(tools.values.unknown,undefined);assert.equal(node('.teleprompter').textContent.length,30000);assert.deepEqual(volumes,[['micVolume',0],['screenVolume',1.5]]);assert.deepEqual(Object.keys(tools.scenes),['intro']);
});

test('invalid stored audio types use defaults and a failed scene save keeps notes dirty',async t=>{
 const {tools,input,storage,volumes,messages}=productionFixture(t,{saved:{intro:{micVolume:'0',screenVolume:null}}});await tools.action({dataset:{production:'load-scene'}});assert.deepEqual(volumes,[['micVolume',1],['screenVolume',1]]);input('notes','Keep this private draft');const before=storage.get('go-streams-scenes');localStorage.setItem=()=>{throw Error('Quota exceeded');};await tools.action({dataset:{production:'save-scene'}});assert.equal(tools.hasUnsavedChanges,true);assert.equal(storage.get('go-streams-scenes'),before);assert.ok(messages.some(message=>message.error));
});

test('trimming an oversized saved scene never leaves half of an emoji in a text field',async t=>{
 const {tools}=productionFixture(t,{saved:{intro:{name:'n'.repeat(79)+'😀',notes:'p'.repeat(29999)+'😀'}}});await tools.action({dataset:{production:'load-scene'}});
 assert.equal(tools.values.name,'n'.repeat(79));assert.equal(tools.values.notes,'p'.repeat(29999));assert.equal(tools.values.name.isWellFormed(),true);assert.equal(tools.values.notes.isWellFormed(),true);
});

test('saved private notes stay outside the composed frame',async t=>{
 const {tools,input}=productionFixture(t);input('notes','Private phrase that must not be recorded');tools.values.banner='Public banner';const text=[],ctx={fillRect(){},drawImage(){},fillText:value=>text.push(value),measureText:()=>({width:10})};
 tools.draw(ctx,1280,720,null,null,()=>assert.fail('No camera or screen'));assert.deepEqual(text,['Public banner']);
});
