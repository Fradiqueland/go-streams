import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {Store,Vault,Studio,runProcess} from '../src/core.mjs';
import {LocalRecordings} from '../src/local-recordings.mjs';
import {cropRect,cameraRect,cameraPosition,frameSize,containedRect,selectionRect,recordingAspects,watermarkRect} from '../public/recorder-geometry.js';
import {RecordingUpload,countdown,RecorderPanel} from '../public/recorder.js';
import {uiHarness} from './ui-harness.mjs';

test('screen crops, camera squares and even output dimensions stay inside landscape and portrait frames',()=>{
 for(const [w,h]of [[1920,1080],[1080,1920],[640,360]])for(const crop of [{},{x:.8,y:.9,width:.5,height:.4},{width:0,height:0},{x:NaN,y:-10,width:20,height:Infinity}]){
  const r=cropRect(crop);assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1&&r.y+r.height<=1);
  const f=frameSize(w,h,r);assert.equal(f.width%2,0);assert.equal(f.height%2,0);assert.ok(f.width<=1920&&f.height<=1080);
  for(const p of [{},{x:-2,y:5,size:5},{x:.5,y:.5,size:.25}]){const c=cameraRect(p,w,h);assert.equal(c.width,c.height);assert.ok(c.x>=0&&c.y>=0&&c.x+c.width<=w&&c.y+c.height<=h);}
 }
 assert.deepEqual(containedRect({left:10,top:20,width:400,height:400},1600,900),{left:10,top:107.5,width:400,height:225});
 const selected=selectionRect({x:.9,y:.8},{x:.1,y:.2});assert.equal(selected.x,.1);assert.equal(selected.width,.8);assert.ok(Math.abs(selected.height-.6)<1e-12);
});

test('fixed recording aspect ratios produce exact even dimensions at both quality levels',()=>{
 const expected={'16:9':[1920,1080],'9:16':[1080,1920],'1:1':[1080,1080],'4:3':[1440,1080],'3:4':[1080,1440]};
 assert.deepEqual(recordingAspects,['original',...Object.keys(expected)]);
 for(const [aspect,[width,height]]of Object.entries(expected))for(const quality of [720,1080])for(const source of [[640,360],[1080,1920]]){
  const result=frameSize(...source,{x:.5,width:.5},quality,aspect);assert.deepEqual(result,{width:width*quality/1080,height:height*quality/1080});assert.equal(result.width%2,0);assert.equal(result.height%2,0);
 }
 assert.deepEqual(frameSize(640,360,{x:.5,width:.5},1080,'original'),{width:320,height:360});
 assert.deepEqual(frameSize(640,360,{},1080,'unsupported'),frameSize(640,360,{},1080));
});

test('screen crops fit fixed portrait output without stretching while camera output fills it',()=>{
 const calls=[],context={fillRect(){},drawImage(...args){calls.push(args);}},panel=new RecorderPanel({api(){},toast(){}});
 panel.canvas={width:1080,height:1920,getContext:()=>context};panel.config={mode:'screen'};panel.screenVideo={videoWidth:640,videoHeight:360};panel.crop=cropRect({x:.5,width:.5});
 panel.draw();assert.equal(calls.length,1);assert.deepEqual(calls[0],[panel.screenVideo,320,0,320,360,0,352.5,1080,1215]);
 calls.length=0;panel.config.mode='camera';panel.cameraVideo={videoWidth:640,videoHeight:480};panel.draw();assert.equal(calls.length,1);assert.deepEqual(calls[0],[panel.cameraVideo,185,0,270,480,0,0,1080,1920]);
});

test('aspect changes update prepared output without reacquiring capture and lock for recording lifecycle',()=>{
 const panel=new RecorderPanel({api(){},toast(){}}),fields=new Map(),output={},screen={videoWidth:640,videoHeight:360};let draws=0;
 panel.$=selector=>{if(!fields.has(selector))fields.set(selector,{});return fields.get(selector);};panel.positionBoxes=()=>{};panel.draw=()=>draws++;
 panel.canvas={};panel.config={mode:'screen',quality:720,aspect:'original'};panel.screenVideo=screen;panel.output=output;
 panel.changeAspect('9:16');assert.deepEqual(panel.canvas,{width:720,height:1280});assert.equal(panel.output,output);assert.equal(panel.screenVideo,screen);assert.equal(draws,1);
 for(const state of [{starting:true},{id:'recording'},{finishing:true},{preparing:true}]){Object.assign(panel,{starting:false,id:null,finishing:false,preparing:false},state);panel.changeAspect('1:1');assert.equal(panel.config.aspect,'9:16');assert.equal(draws,1);}
 Object.assign(panel,{starting:false,id:null,finishing:false,preparing:false});panel.config.mode='audio';panel.changeAspect('1:1');assert.equal(panel.config.aspect,'9:16');
});

test('aspect selector is editable with prepared video and disabled for countdown, recording, saving and audio',()=>{
 const fields=new Map(),panel=new RecorderPanel({api(){},toast(){}});panel.element={querySelectorAll:()=>[]};panel.$=selector=>{if(!fields.has(selector))fields.set(selector,{});return fields.get(selector);};
 panel.$('[name="mode"]').value='screen';panel.$('[name="sound"]').value='none';panel.config={mode:'screen'};panel.output={};
 panel.controls();assert.equal(panel.$('[name="aspect"]').disabled,false);
 for(const state of [{starting:true},{id:'recording'},{finishing:true},{preparing:true}]){Object.assign(panel,{starting:false,id:null,finishing:false,preparing:false},state);panel.controls();assert.equal(panel.$('[name="aspect"]').disabled,true);}
 Object.assign(panel,{starting:false,id:null,finishing:false,preparing:false});panel.$('[name="mode"]').value='audio';panel.controls();assert.equal(panel.$('[name="aspect"]').disabled,true);
});

test('preview watermark tracks the contained video rectangle for landscape, portrait and square output',()=>{
 const panel=new RecorderPanel({api(){},toast(){}}),stage={left:10,top:20,width:640,height:360},fields=new Map();
 panel.element={isConnected:true};panel.$=selector=>{if(!fields.has(selector))fields.set(selector,{style:{},getBoundingClientRect:()=>stage});return fields.get(selector);};
 for(const [width,height]of [[1920,1080],[1080,1920],[1080,1080]]){
  panel.canvas={width,height};panel.positionBoxes();const view=containedRect(stage,width,height),mark=watermarkRect(width,height),scale=view.width/width,style=panel.$('.recorder-watermark').style;
  assert.equal(mark.width%2,0);assert.equal(mark.x+mark.width,width-Math.max(8,Math.round(Math.min(width,height)*.02)));
  assert.equal(parseFloat(style.left),view.left-stage.left+mark.x*scale);assert.equal(parseFloat(style.top),view.top-stage.top+mark.y*scale);assert.equal(parseFloat(style.width),mark.width*scale);assert.equal(parseFloat(style.height),mark.height*scale);
 }
});

test('cancelled countdown settles promptly without starting a recording',async()=>{
 const controller=new AbortController(),ticks=[];const waiting=countdown(10,n=>ticks.push(n),controller.signal);controller.abort();assert.equal(await waiting,false);assert.equal(ticks[0],10);assert.equal(ticks.at(-1),null);
 const ended=new AbortController();ended.abort();assert.equal(await countdown(3,()=>assert.fail(),ended.signal),false);
 assert.equal(await countdown(0,()=>{},new AbortController().signal),true);
});

test('local recording uploads are ordered, bounded and stop acknowledging failed chunks',async()=>{
 let unblock;const gate=new Promise(resolve=>{unblock=resolve;});const sent=[],errors=[];const q=new RecordingUpload(async(blob,n)=>{await gate;sent.push([blob.size,n]);},e=>errors.push(e),10);
 q.push(new Blob(['one']));q.push(new Blob(['two']));assert.equal(q.bytes,6);unblock();await q.finish();assert.deepEqual(sent,[[3,0],[3,1]]);assert.equal(q.bytes,0);
 const failed=new RecordingUpload(async()=>{throw Error('Disk full');},e=>errors.push(e));failed.push(new Blob(['data']));failed.push(new Blob(['next']));await assert.rejects(failed.finish(),/Disk full/);assert.equal(failed.sequence,1);assert.equal(failed.bytes,0);
 const overflow=new RecordingUpload(async()=>assert.fail(),e=>errors.push(e),2);overflow.push(new Blob(['too big']));await assert.rejects(overflow.finish());assert.equal(errors.length,2);
});

test('cancelling a start retains source-ended handlers and closing preview releases all devices',async()=>{
 const calls=[],panel=new RecorderPanel({api:async route=>{calls.push(route);return {};},toast(){}}),stream={getTracks:()=>[{stop(){calls.push('track-stop');}}]};
 panel.element={querySelector:()=>({srcObject:null,value:0})};panel.output=stream;panel.streams=[stream];panel.controls=()=>{};panel.status=()=>{};
 panel.starting=true;panel.countdownAbort=new AbortController();panel.startDone=Promise.resolve().then(()=>{panel.starting=false;});const generation=panel.generation;await panel.stop();assert.equal(panel.generation,generation);assert.equal(panel.countdownAbort.signal.aborted,true);
 await panel.release();assert.equal(panel.output,null);assert.ok(calls.includes('track-stop'));assert.equal(calls.filter(c=>c.startsWith('/api/')).length,0);
});

test('camera numeric controls normalize values to the position actually drawn',()=>{
 const fields=new Map(),panel=new RecorderPanel({api(){},toast(){}});
 panel.$=name=>{if(!fields.has(name))fields.set(name,{});return fields.get(name);};panel.positionBoxes=()=>{};
 panel.cameraPosition={x:1.5,y:-.2,size:2};panel.syncCamera();
 assert.deepEqual(panel.cameraPosition,{x:1,y:0,size:.65});
 assert.equal(panel.$('[name="cameraX"]').value,100);assert.equal(panel.$('[name="cameraY"]').value,0);assert.equal(panel.$('[name="cameraSize"]').value,65);
 assert.deepEqual(cameraPosition({x:NaN,y:Infinity,size:-2}),{x:0,y:0,size:.1});
});

test('crop drag already in progress cannot change the canvas after recording starts or preview closes',()=>{
 const panel=new RecorderPanel({api(){},toast(){}});let move,resizes=0;
 panel.screenVideo={videoWidth:1600,videoHeight:900};panel.$=()=>({getBoundingClientRect:()=>({left:0,top:0,width:1600,height:900})});
 panel.pointerSession=(_event,callback)=>{move=callback;};panel.syncCrop=()=>{};panel.resizeCanvas=()=>resizes++;
 panel.selectRegion({button:0,clientX:100,clientY:100});move({clientX:800,clientY:450});assert.equal(resizes,1);const selected={...panel.crop};
 for(const state of [{starting:true},{id:'recording'},{finishing:true},{screenVideo:null}]){
  Object.assign(panel,{starting:false,id:null,finishing:false},state);move({clientX:1200,clientY:800});assert.deepEqual(panel.crop,selected);assert.equal(resizes,1);
 }
});

test('concurrent stop requests while start settles share a single finalization',async()=>{
 const panel=new RecorderPanel({api(){},toast(){}});let startReady,writerReady,writes=0,reloads=0;
 panel.controls=()=>{};panel.status=()=>{};panel.starting=true;panel.countdownAbort=new AbortController();
 panel.startDone=new Promise(resolve=>{startReady=resolve;});const writing=new Promise(resolve=>{writerReady=resolve;});
 panel.stopWriter=async()=>{writes++;await writing;panel.id=null;};panel.reloadFiles=async()=>{reloads++;};
 const first=panel.stop(),second=panel.stop();panel.starting=false;panel.id='recording';startReady();
 await Promise.resolve();await Promise.resolve();assert.equal(writes,1);writerReady();await Promise.all([first,second]);assert.equal(reloads,1);assert.equal(panel.finishing,false);
});

test('inactive recorder still drains its final browser data event before closing the saved file',async()=>{
 const calls=[],panel=new RecorderPanel({api:async route=>{calls.push(route);},toast(){}});let stopped;
 panel.id='recording';panel.status=()=>{};panel.recorderStarted=true;panel.recorder={state:'inactive',stop(){assert.fail('Already inactive');}};
 panel.recorderDone=new Promise(resolve=>{stopped=resolve;});panel.upload=new RecordingUpload(async blob=>calls.push(await blob.text()),assert.fail);
 const saving=panel.stopWriter();await Promise.resolve();assert.deepEqual(calls,[]);
 panel.upload.push(new Blob(['last-chunk']));stopped();await saving;
 assert.deepEqual(calls,['last-chunk','/api/recordings/recording/finish']);assert.equal(panel.id,null);assert.equal(panel.recorderStarted,false);
});

test('failed MediaRecorder start does not wait for a stop event that cannot arrive',async()=>{
 const calls=[],panel=new RecorderPanel({api:async route=>calls.push(route),toast(){}});
 panel.id='recording';panel.status=()=>{};panel.recorderStarted=false;panel.recorder={state:'inactive',stop(){assert.fail('Never started');}};panel.recorderDone=new Promise(()=>{});
 await panel.stopWriter();assert.deepEqual(calls,['/api/recordings/recording/finish']);assert.equal(panel.id,null);
});

function replaceGlobal(t,name,value){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}

test('first recorder mount lists permitted devices once and tracks later device changes without opening them',t=>{
 const nodes=new Map(),listeners=new Map(),calls=[],element={addEventListener(){},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{addEventListener(){}});return nodes.get(selector);}};
 replaceGlobal(t,'document',{createElement:()=>element});replaceGlobal(t,'window',{addEventListener(){}});
 replaceGlobal(t,'navigator',{mediaDevices:{getUserMedia(){assert.fail('Enumeration must not open devices');},addEventListener(name,callback){assert.ok(!listeners.has(name));listeners.set(name,callback);}}});
 const panel=new RecorderPanel({api(){},toast(){}}),container={appendChild(child){child.parentNode=this;}};
 panel.listDevices=async generation=>calls.push(generation);panel.update=()=>{};panel.positionBoxes=()=>{};
 panel.mount(container,{});panel.mount(container,{});assert.deepEqual(calls,[0]);assert.equal(listeners.size,1);
 panel.generation=3;listeners.get('devicechange')();assert.deepEqual(calls,[0,3]);
});

test('device refresh preserves an available selection and falls back to default after unplugging it',async t=>{
 let devices=[{kind:'videoinput',deviceId:'camera2',label:'Camera <two>'},{kind:'audioinput',deviceId:'microphone1',label:'Microphone'}];
 replaceGlobal(t,'navigator',{mediaDevices:{enumerateDevices:async()=>devices}});
 const panel=new RecorderPanel({api(){},toast(){}}),fields={'[name="camera"]':{value:'camera2'},'[name="microphone"]':{value:'missing-microphone'}};panel.$=selector=>fields[selector];
 await panel.listDevices(0);assert.equal(fields['[name="camera"]'].value,'camera2');assert.match(fields['[name="camera"]'].innerHTML,/Camera &lt;two&gt;/);assert.equal(fields['[name="microphone"]'].value,'');
 devices=devices.filter(device=>device.kind!=='videoinput');await panel.listDevices(0);assert.equal(fields['[name="camera"]'].value,'');assert.doesNotMatch(fields['[name="camera"]'].innerHTML,/camera2/);
});

test('out-of-order device enumeration does not restore devices that a newer refresh removed',async t=>{
 const requests=[];replaceGlobal(t,'navigator',{mediaDevices:{enumerateDevices:()=>new Promise(resolve=>requests.push(resolve))}});
 const panel=new RecorderPanel({api(){},toast(){}}),fields={'[name="camera"]':{value:''},'[name="microphone"]':{value:''}};panel.$=selector=>fields[selector];
 const first=panel.listDevices(0),second=panel.listDevices(0);requests[1]([]);await second;const latest=fields['[name="camera"]'].innerHTML;
 requests[0]([{kind:'videoinput',deviceId:'removed',label:'Removed camera'}]);await first;assert.equal(fields['[name="camera"]'].innerHTML,latest);
});

test('cancellation during the start API response discards only the newly created empty writer',async t=>{
 let startResponse,mediaStarts=0;const calls=[];
 class FakeRecorder{static isTypeSupported(){return true;}start(){mediaStarts++;}}
 replaceGlobal(t,'MediaRecorder',FakeRecorder);
 const panel=new RecorderPanel({api:async(route,body)=>{calls.push({route,body});if(route==='/api/recordings/start')return new Promise(resolve=>{startResponse=resolve;});return {};},toast(){}}),fields=new Map();
 panel.$=selector=>{if(!fields.has(selector))fields.set(selector,{});return fields.get(selector);};panel.$('[name="directory"]').value='chosen-directory';panel.$('[name="askFolder"]').checked=false;
 panel.output={};panel.config={mode:'audio',countdown:0};panel.controls=()=>{};panel.status=()=>{};panel.error=assert.fail;
 const pending=panel.start();await Promise.resolve();assert.equal(typeof startResponse,'function');panel.countdownAbort.abort();startResponse({id:'empty-recording'});await pending;
 assert.deepEqual(calls.at(-1),{route:'/api/recordings/empty-recording/finish',body:{discardEmpty:true}});assert.equal(mediaStarts,0);assert.equal(panel.starting,false);assert.ok(!panel.id);
});

for(const [mode,supported,expected]of [
 ['screen',['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus'],'video/webm;codecs=vp9,opus'],
 ['camera',['video/webm;codecs=vp8,opus'],'video/webm;codecs=vp8,opus'],
 ['screen',['video/webm'],'video/webm'],
 ['audio',['audio/webm;codecs=opus','audio/webm'],'audio/webm;codecs=opus']
])test('recording chooses '+expected+' from available '+mode+' codecs and still closes its writer',async t=>{
 let selected,starts=0,finishes=0;
 class FakeRecorder extends EventTarget{static isTypeSupported(type){return supported.includes(type);}constructor(_stream,options){super();selected=options.mimeType;this.state='inactive';}start(){starts++;this.state='recording';}stop(){this.state='inactive';this.dispatchEvent(new Event('stop'));}}
 replaceGlobal(t,'MediaRecorder',FakeRecorder);
 const panel=new RecorderPanel({api:async(route)=>{if(route==='/api/recordings/start')return {id:'codec-recording'};if(route.endsWith('/finish'))finishes++;return {};},toast(){}}),fields=new Map();
 panel.$=selector=>{if(!fields.has(selector))fields.set(selector,{});return fields.get(selector);};panel.$('[name="directory"]').value='chosen-directory';panel.$('[name="askFolder"]').checked=false;
 panel.output={};panel.config={mode,countdown:0};panel.controls=()=>{};panel.status=()=>{};panel.error=assert.fail;
 t.after(()=>panel.stopWriter());await panel.start();assert.equal(selected,expected);assert.equal(starts,1);await panel.stopWriter();assert.equal(finishes,1);assert.equal(panel.id,null);
});

test('recorder route exists and language switching retains a prepared recorder and folder draft',async()=>{
 const h=uiHarness({locale:'en'});h.run('draw()');assert.match(h.element('#nav').innerHTML,/#recorder/);
 for(const value of ['{busy:true}','{busy:false,hasUnsavedChanges:true}']){
  let reloads=0;h.context.location.reload=()=>reloads++;h.run('recorderPanel='+value);h.element('#language-select').value='es';await h.element('#language-select').onchange({target:h.element('#language-select')});assert.equal(reloads,0);assert.equal(h.element('#language-select').value,'en');
 }
});

function fixture(t){const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'standalone-recorder-')),store=new Store(root),studio=new Studio(store,new Vault(root,{portable:true})),recordings=new LocalRecordings(studio,{clock:false});t.after(async()=>{await recordings.shutdown();await studio.shutdown();assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {root,studio,recordings};}
for(const kind of ['video','audio'])test('streamed '+kind+' recording is encoded while receiving, saved in the chosen folder and reopened',async t=>{
 const {root,studio,recordings}=fixture(t),source=path.join(root,'input.webm'),directory=path.join(root,'Chosen folder');
 await runProcess('ffmpeg',['-v','error',...(kind==='video'?['-f','lavfi','-i','testsrc2=size=320x180:rate=20']:[]),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.3',...(kind==='video'?['-c:v','libvpx','-deadline','realtime']:['-vn']),'-c:a','libopus','-y',source]);
 const format=kind==='audio'?'m4a':'mp4';const {id}=recordings.start({confirmed:true,kind,format,directory});assert.ok(recordings.active.get(id).child,'Encoding must begin immediately');
 const bytes=fs.readFileSync(source);for(let n=0,at=0;at<bytes.length;n++,at+=4096){const req=Readable.from([bytes.subarray(at,at+4096)]);req.headers={'content-type':kind==='audio'?'audio/webm':'video/webm'};await recordings.ingest(id,String(n),req);}
 await recordings.finish(id);assert.equal(recordings.state()[0].status,'completed');const file=recordings.media(id);assert.equal(path.dirname(file),fs.realpathSync(directory));assert.equal(path.extname(file),'.'+format);
 const media=JSON.parse((await runProcess('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file])).stdout);assert.ok(Number(media.format.duration)>1);assert.equal(media.streams.find(s=>s.codec_type==='audio').codec_name,'aac');assert.equal(media.streams.some(s=>s.codec_type==='video'),kind==='video');if(kind==='video')assert.equal(media.streams.find(s=>s.codec_type==='video').codec_name,'h264');
 const reopened=new LocalRecordings(studio,{clock:false});assert.equal(reopened.media(id),file);await reopened.shutdown();assert.ok(!fs.existsSync(path.join(directory,id+'.part')));
});

test('invalid audio/video format pairs are rejected before any files or processes are created',t=>{
 const {recordings}=fixture(t);
 for(const input of [{kind:'audio',format:'mp4'},{kind:'video',format:'m4a'},{kind:'other'},{format:'../../file'},{kind:'audio',feedId:'x'}])assert.throws(()=>recordings.start({confirmed:true,...input}),/valid recording/);
 assert.equal(recordings.items.length,0);assert.equal(recordings.active.size,0);
});
