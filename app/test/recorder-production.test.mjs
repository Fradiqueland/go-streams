import test from 'node:test';
import assert from 'node:assert/strict';
import {RecorderPanel} from '../public/recorder.js';
import {ProductionTools} from '../public/live-production.js';

function replaceGlobal(t,name,value){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}
function drawing(events=[]){return {events,fillRect(...args){events.push(['fill',this.fillStyle,...args]);},drawImage(source,...args){events.push(['image',source.id,...args]);},fillText(text,...args){events.push(['text',text,...args]);},measureText:()=>({width:240}),save(){events.push(['save']);},restore(){events.push(['restore']);},translate(...args){events.push(['translate',...args]);},scale(...args){events.push(['scale',...args]);}};}
function composedPanel(){
 const panel=new RecorderPanel({api(){assert.fail('Drawing cannot access the server');},toast:assert.fail}),ctx=drawing();
 panel.config={mode:'screen-camera',sound:'both'};panel.canvas={width:1000,height:600,getContext:()=>ctx};panel.screenVideo={id:'screen',videoWidth:1000,videoHeight:500};panel.cameraVideo={id:'camera',videoWidth:800,videoHeight:600};
 panel.crop={x:.2,y:.1,width:.5,height:.6};panel.cameraPosition={x:.25,y:.5,size:.3};panel.production=new ProductionTools({recordingControls:false});return {panel,ctx,tools:panel.production};
}

test('recorder composition preserves the selected crop and movable square camera below all production graphics',()=>{
 const {panel,ctx,tools}=composedPanel();tools.images={backgroundImage:{id:'background'},logo:{id:'logo',width:200,height:100}};
 Object.assign(tools.values,{name:'Presenter',title:'Title',banner:'Banner 🎉',ticker:'News 🔥'});panel.draw();
 const images=ctx.events.filter(event=>event[0]==='image');assert.deepEqual(images.map(event=>event[1]),['background','screen','camera','logo']);
 assert.deepEqual(images[1],['image','screen',200,50,500,300,0,0,1000,600]);assert.deepEqual(images[2],['image','camera',100,0,600,600,205,210,180,180]);
 assert.deepEqual(ctx.events.filter(event=>event[0]==='text').map(event=>event[1]),['Presenter — Title','Banner 🎉','News 🔥']);
 assert.ok(ctx.events.filter(event=>event[0]==='text').every(event=>ctx.events.indexOf(event)>ctx.events.indexOf(images[3])));
 panel.canvas.width=600;panel.canvas.height=1000;ctx.events.length=0;panel.draw();
 assert.deepEqual(ctx.events.find(event=>event[0]==='image'&&event[1]==='screen'),['image','screen',200,50,500,300,0,320,600,360]);
 assert.deepEqual(ctx.events.find(event=>event[0]==='image'&&event[1]==='camera'),['image','camera',100,0,600,600,105,410,180,180]);
 assert.deepEqual(panel.crop,{x:.2,y:.1,width:.5,height:.6});assert.deepEqual(panel.cameraPosition,{x:.25,y:.5,size:.3});
});

test('recorder camera, screen and split layouts respect source bounds and mirror only the camera in its final position',()=>{
 const cases=[
  {layout:'screen',screen:[200,50,500,300,0,0,1000,600]},
  {layout:'camera',camera:[0,60,800,480,0,0,1000,600],translate:[1000,0]},
  {layout:'split',screen:[200,50,500,300,0,108,640,384],camera:[187.5,0,425,600,660,60,340,480],translate:[1000,60]},
  {layout:'pip',screen:[200,50,500,300,0,0,1000,600],camera:[100,0,600,600,205,210,180,180],translate:[385,210]}
 ];
 for(const spec of cases)for(const mirror of [false,true]){
  const {panel,ctx,tools}=composedPanel();Object.assign(tools.values,{layout:spec.layout,mirror});panel.draw();
  const images=ctx.events.filter(event=>event[0]==='image');assert.deepEqual(images.map(event=>event[1]),['screen','camera'].filter(source=>spec[source]));
  if(spec.screen)assert.deepEqual(images.find(event=>event[1]==='screen'),['image','screen',...spec.screen]);
  if(spec.camera){const expected=[...spec.camera];if(mirror){expected[4]=0;expected[5]=0;}assert.deepEqual(images.find(event=>event[1]==='camera'),['image','camera',...expected]);}
  assert.deepEqual(ctx.events.filter(event=>event[0]==='translate'),mirror&&spec.camera?[['translate',...spec.translate]]:[]);
  assert.deepEqual(ctx.events.filter(event=>event[0]==='scale'),mirror&&spec.camera?[['scale',-1,1]]:[]);
  assert.equal(ctx.events.filter(event=>event[0]==='save').length,mirror&&spec.camera?1:0);assert.equal(ctx.events.filter(event=>event[0]==='restore').length,mirror&&spec.camera?1:0);
 }
});

test('a recorder clip replaces cropped sources without hiding the banner, ticker or image overlays',()=>{
 const {panel,ctx,tools}=composedPanel();tools.clip={id:'clip',videoWidth:1600,videoHeight:900,paused:false,ended:false};tools.images.logo={id:'logo',width:200,height:100};tools.values.banner='Keep banner';tools.values.ticker='Keep ticker';panel.draw();
 const images=ctx.events.filter(event=>event[0]==='image');assert.deepEqual(images.map(event=>event[1]),['screen','camera','clip','logo']);assert.deepEqual(images[2],['image','clip',0,18.75,1000,562.5]);
 assert.ok(ctx.events.filter(event=>event[0]==='text').every(event=>ctx.events.indexOf(event)>ctx.events.indexOf(images[2])));
 tools.clip.ended=true;ctx.events.length=0;panel.draw();assert.deepEqual(ctx.events.filter(event=>event[0]==='image').map(event=>event[1]),['screen','camera','logo']);
});

// Exercise the real recorder/production callbacks and prepare path with controlled
// media APIs. This harness makes no browser rendering or device permission claims.
function preparedFixture(t,{sound='both',mode='screen-camera'}={}){
 const nodes=new Map(),intervals=new Map(),audioContexts=[],videos=[],revoked=[],requests=[],messages=[],ctx=drawing();let intervalId=0;
 const node=selector=>{const key=/\[name=["']?([^\]"']+)/.exec(selector)?.[1]||selector;if(!nodes.has(key))nodes.set(key,{value:'',hidden:false,disabled:false,style:{},before(){},addEventListener(){}});return nodes.get(key);};
 const panel=new RecorderPanel({api:async route=>{requests.push(route);return {};},toast:(...args)=>messages.push(args)});t.after(()=>panel.releaseDevices());
 panel.element={isConnected:false,querySelector:node,querySelectorAll:selector=>selector==='meter'?[node('meter'),node('.production-meter')]:[]};panel.element.parentNode={};
 t.mock.method(ProductionTools.prototype,'mount',function(){this.element={isConnected:true,hidden:false,getClientRects:()=>[{}],querySelector:node};});
 panel.mount(panel.element.parentNode,{});const tools=panel.production;
 for(const [name,value]of Object.entries({mode,sound,quality:'720',aspect:'original',countdown:'0',camera:'',microphone:'',micVolume:'1',screenVolume:'1'}))node(`[name="${name}"]`).value=value;
 class Track extends EventTarget{constructor(kind){super();this.kind=kind;this.readyState='live';this.stops=0;}stop(){this.stops++;this.readyState='ended';}}
 class Stream{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio');}getVideoTracks(){return this.tracks.filter(track=>track.kind==='video');}}
 const screen=new Stream([new Track('video'),...(['system','both'].includes(sound)?[new Track('audio')]:[])]),device=new Stream([...(['camera','screen-camera'].includes(mode)?[new Track('video')]:[]),...(['microphone','both'].includes(sound)?[new Track('audio')]:[])]);screen.id='screen';device.id='camera';
 const audioNode=()=>({gain:{value:1},connections:[],disconnects:0,connect(target){this.connections.push(target);return target;},disconnect(){this.disconnects++;}});
 class AudioContext{
  constructor(){audioContexts.push(this);this.destination=audioNode();this.gains=[];this.sources=[];this.clipSources=[];this.closed=0;}
  async resume(){}async close(){this.closed++;}createGain(){const gain=audioNode();this.gains.push(gain);return gain;}
  createMediaStreamDestination(){return {stream:new Stream([new Track('audio')])};}
  createAnalyser(){return {...audioNode(),fftSize:8,getByteTimeDomainData(samples){samples.fill(160);}};}
  createMediaStreamSource(stream){const source={...audioNode(),stream};this.sources.push(source);return source;}
  createMediaElementSource(video){const source={...audioNode(),video};this.clipSources.push(source);return source;}
 }
 class MediaRecorder{static isTypeSupported(){return true;}}
 replaceGlobal(t,'AudioContext',AudioContext);replaceGlobal(t,'MediaStream',Stream);replaceGlobal(t,'MediaRecorder',MediaRecorder);replaceGlobal(t,'window',{MediaRecorder});
 replaceGlobal(t,'navigator',{mediaDevices:{getDisplayMedia:async()=>screen,getUserMedia:async()=>device,enumerateDevices:async()=>[]}});
 replaceGlobal(t,'setInterval',(callback,delay)=>{const id=++intervalId;intervals.set(id,{callback,delay});return id;});replaceGlobal(t,'clearInterval',id=>intervals.delete(id));
 replaceGlobal(t,'document',{createElement(tag){if(tag==='canvas')return {width:0,height:0,getContext:()=>ctx,captureStream:()=>new Stream([new Track('video')])};assert.equal(tag,'video');const video={id:'clip',videoWidth:1000,videoHeight:600,paused:true,ended:false,src:'',muted:false,async play(){this.paused=false;},pause(){this.paused=true;},set srcObject(stream){this.stream=stream;if(stream)this.id=stream.id;},get srcObject(){return this.stream;}};videos.push(video);return video;}});
 t.mock.method(URL,'createObjectURL',()=> 'blob:recorder-clip');t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 return {panel,tools,node,intervals,audioContexts,screen,device,videos,revoked,requests,messages,ctx};
}

test('prepared recorder routes microphone and shared audio through independent production volume controls',async t=>{
 const {panel,tools,node,audioContexts,messages}=preparedFixture(t);node('[name="micVolume"]').value='.8';node('[name="screenVolume"]').value='1.2';await panel.prepare();assert.deepEqual(messages,[]);assert.ok(panel.output);
 assert.equal(panel.output.getVideoTracks().length,1);assert.equal(panel.output.getAudioTracks().length,1);assert.equal(audioContexts.length,1);
 assert.deepEqual(panel.audioInputs.map(input=>[input.name,input.gain.gain.value]),[['screenVolume',.6],['micVolume',.4]]);
 tools.setVolume('micVolume',1.4);assert.deepEqual(panel.audioInputs.map(input=>input.gain.gain.value),[.6,.7]);tools.setVolume('screenVolume',0);assert.deepEqual(panel.audioInputs.map(input=>input.gain.gain.value),[0,.7]);
 assert.ok(audioContexts[0].sources.every(source=>source.stream.getVideoTracks().length===0));assert.ok(panel.audioInputs.every(input=>input.gain.connections[0]===panel.audioMix));
});

test('playing and ending a recorder clip mutes both inputs and restores the latest independent volumes',async t=>{
 const {panel,tools,node,audioContexts,messages}=preparedFixture(t);await panel.prepare();node('[name=clipFile]').files=[{type:'video/mp4'}];await tools.action({dataset:{production:'play-clip'}});assert.deepEqual(messages,[]);
 const clip=tools.clip,source=panel.clipAudio;assert.equal(clip.muted,false);assert.equal(source.video,clip);assert.deepEqual(source.connections,[panel.audioMix]);assert.deepEqual(panel.audioInputs.map(input=>input.gain.gain.value),[0,0]);
 node('[name="micVolume"]').value='.6';node('[name="screenVolume"]').value='1.4';tools.setVolume('micVolume',.6);tools.setVolume('screenVolume',1.4);assert.deepEqual(panel.audioInputs.map(input=>input.gain.gain.value),[0,0]);
 clip.onended();assert.equal(panel.clipAudio,null);assert.equal(tools.clip,null);assert.equal(source.disconnects,1);assert.deepEqual(panel.audioInputs.map(input=>input.gain.gain.value),[.7,.3]);assert.equal(audioContexts[0].clipSources.length,1);
 assert.equal(panel.output.getAudioTracks().length,1);
});

test('silent recorder clips stay muted and never create an audio context or add an output audio track',async t=>{
 const {panel,tools,node,audioContexts,messages}=preparedFixture(t,{sound:'none'});await panel.prepare();node('[name=clipFile]').files=[{type:'video/webm'}];await tools.action({dataset:{production:'play-clip'}});assert.deepEqual(messages,[]);
 assert.ok(tools.clip);assert.equal(tools.clip.muted,true);assert.equal(audioContexts.length,0);assert.equal(panel.clipAudio,null);assert.equal(panel.output.getAudioTracks().length,0);assert.equal(panel.output.getVideoTracks().length,1);
 tools.stopClip();assert.equal(panel.output.getAudioTracks().length,0);
});

test('recorder composition exposes square camera handles only for pip and keeps audio-only controls separate',async t=>{
 const {panel,tools,node}=preparedFixture(t);await panel.prepare();
 for(const layout of ['pip','split','camera','screen']){tools.values.layout=layout;panel.controls();assert.equal(node('.recorder-camera-box').hidden,layout!=='pip');assert.equal(node('.recorder-camera-controls').hidden,layout!=='pip');}
 tools.values.layout='pip';tools.clip={};panel.controls();assert.equal(node('.recorder-camera-box').hidden,true);tools.clip=null;
 node('[name="sound"]').value='microphone';panel.controls();assert.equal(node('[name="micVolume"]').disabled,false);assert.equal(node('[name="screenVolume"]').disabled,true);
 node('[name="mode"]').value='audio';panel.controls();assert.equal(tools.element.hidden,true);assert.equal(node('[name="aspect"]').disabled,true);
});

test('recorder production shortcuts use the recorder lifecycle and ignore hidden, audio-only and busy panels',async t=>{
 const {panel,tools,node,requests}=preparedFixture(t);await panel.prepare();const calls=[];panel.start=async()=>calls.push('start');panel.stop=async()=>calls.push('stop');panel.config.mode='screen';
 const event={ctrlKey:true,altKey:true,key:'r',code:'KeyR',preventDefault(){}};tools.handleKeydown(event);panel.id='active';tools.handleKeydown(event);assert.deepEqual(calls,['start','stop']);
 for(const field of ['finishing','preparing','starting','folderBusy','releaseDone']){panel[field]=true;tools.handleKeydown(event);panel[field]=false;}
 tools.element.isConnected=false;tools.handleKeydown(event);tools.element.isConnected=true;tools.element.hidden=true;tools.handleKeydown(event);tools.element.hidden=false;panel.config.mode='audio';tools.handleKeydown(event);assert.deepEqual(calls,['start','stop']);assert.deepEqual(requests,[]);
 panel.config.mode='screen';tools.handleKeydown({...event,key:'4',code:'Digit4'});assert.equal(tools.values.layout,'split');assert.equal(node('[name=layout]').value,'split');panel.id=null;
});

test('closing a composed recorder releases all capture and clip resources while retaining its scene',async t=>{
 const {panel,tools,node,intervals,audioContexts,screen,device,videos,revoked}=preparedFixture(t);await panel.prepare();node('[name=clipFile]').files=[{type:'video/mp4'}];await tools.action({dataset:{production:'play-clip'}});
 tools.values.banner='Keep scene';tools.scrollTimer=setInterval(()=>{},50);for(const timer of intervals.values())if(timer.delay===100)timer.callback();assert.ok(node('meter').value>0);assert.ok(node('.production-meter').value>0);
 const clip=tools.clip,clipSource=panel.clipAudio,output=panel.output;await panel.release();
 for(const track of [...screen.getTracks(),...device.getTracks(),...output.getTracks()])assert.equal(track.stops,1);
 assert.ok(videos.every(video=>video.paused));assert.ok(videos.filter(video=>video!==clip).every(video=>video.srcObject===null));assert.equal(clip.src,'');assert.equal(clip.onended,null);assert.equal(clip.onerror,null);
 assert.equal(clipSource.disconnects,1);assert.equal(audioContexts[0].closed,1);assert.equal(intervals.size,0);assert.deepEqual(revoked,['blob:recorder-clip']);assert.equal(tools.values.banner,'Keep scene');assert.equal(tools.clip,null);
 assert.equal(panel.output,null);assert.equal(panel.audio,null);assert.equal(panel.audioMix,null);assert.deepEqual(panel.audioInputs,[]);assert.equal(node('meter').value,0);assert.equal(node('.production-meter').value,0);
});

test('snapshot preserves the clicked frame while its watermark loads and the preview is released',async t=>{
 const {panel,tools,node,ctx,revoked}=preparedFixture(t,{sound:'none'});await panel.prepare();tools.values.banner='Frame at click';
 let decoded,encode;const copies=[],timers=[],mark=node('.recorder-watermark'),original=panel.canvas;Object.assign(mark,{complete:false,naturalWidth:0,decode:()=>new Promise(resolve=>{decoded=resolve;})});
 const imageContext={globalAlpha:1,drawImage(source,...rect){copies.push({source,rect,alpha:this.globalAlpha,text:source===original?ctx.events.filter(event=>event[0]==='text').at(-1)?.[1]:null});}},saved={getContext:()=>imageContext,toBlob(callback,type){assert.equal(type,'image/png');encode=callback;}},link={clicks:0,click(){this.clicks++;}};
 t.mock.method(document,'createElement',tag=>{assert.ok(['canvas','a'].includes(tag));return tag==='canvas'?saved:link;});replaceGlobal(t,'setTimeout',(callback,delay)=>{timers.push({callback,delay});return 1;});
 const button={dataset:{production:'snapshot'}},creating=tools.action(button);assert.equal(button.disabled,true);assert.equal(typeof decoded,'function');assert.equal(encode,undefined);assert.equal(copies.length,1);assert.equal(copies[0].source,original);assert.equal(copies[0].text,'Frame at click');assert.deepEqual([saved.width,saved.height],[original.width,original.height]);
 tools.values.banner='Later frame';panel.draw();await panel.release();assert.equal(panel.output,null);mark.complete=true;mark.naturalWidth=1660;decoded();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(copies.length,2);assert.equal(copies[1].source,mark);assert.equal(copies[1].alpha,.5);assert.equal(copies[0].text,'Frame at click');assert.equal(button.disabled,true);assert.equal(link.clicks,0);assert.equal(typeof encode,'function');
 encode(new Blob(['PNG frame'],{type:'image/png'}));await creating;assert.equal(button.disabled,false);assert.equal(link.clicks,1);assert.match(link.download,/^GoStreams-frame-.*\.png$/);assert.equal(timers.length,1);assert.equal(timers[0].delay,10000);timers[0].callback();assert.deepEqual(revoked,[link.href]);
});

test('a null PNG encoder result rejects the real snapshot and reaches the production error message',async t=>{
 const {panel,tools}=composedPanel(),messages=[],mark={complete:true,naturalWidth:1660};let encode;panel.output={};panel.$=()=>mark;tools.snapshot=()=>panel.snapshot();tools.toast=(message,error)=>messages.push({message,error});
 replaceGlobal(t,'document',{createElement(tag){assert.equal(tag,'canvas','A failed PNG must not create a download link');return {getContext:()=>drawing(),toBlob(callback,type){assert.equal(type,'image/png');encode=callback;}};}});
 t.mock.method(URL,'createObjectURL',()=>assert.fail('A failed PNG must not create a download URL'));
 const button={dataset:{production:'snapshot'}},creating=tools.action(button);assert.equal(button.disabled,true);assert.equal(typeof encode,'function');assert.deepEqual(messages,[]);encode(null);await creating;
 assert.equal(button.disabled,false);assert.equal(messages.length,1);assert.equal(messages[0].error,true);assert.match(messages[0].message,/PNG/);
});
