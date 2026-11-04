import {ProductionTools} from '../public/live-production.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionBumpers} from '../public/production-bumpers.js';
import {RecorderPanel} from '../public/recorder.js';
import {LiveCapturePanel} from '../public/live-capture.js';

function fixture(t,{loadError=false,pending=false,playError=false}={}){
 const previous={document:globalThis.document,localStorage:globalThis.localStorage},videos=[],events=[],messages=[];
 class Video extends EventTarget{
  constructor(){super();this.readyState=0;this.duration=2;this.videoWidth=640;this.currentTime=0;this.paused=true;this.ended=false;videos.push(this);}
  load(){if(this.src&&!pending)queueMicrotask(()=>{this.readyState=2;this.dispatchEvent(new Event(loadError?'error':'loadeddata'));});}
  removeAttribute(name){delete this[name];}pause(){this.paused=true;}
  play(){if(playError)return Promise.reject(Error('Unsupported'));this.paused=false;events.push('play');return Promise.resolve();}
  end(){this.ended=true;this.dispatchEvent(new Event('ended'));}
 }
 globalThis.document={createElement:name=>{assert.equal(name,'video');return new Video();}};
 globalThis.localStorage={getItem:()=>null};t.after(()=>{Object.assign(globalThis,previous);bumpers.cancel();});
 const tools={sceneStorageKey:'test-scenes',recordingControls:true,setClipAudio:video=>events.push(video?'clip-audio':'programme-audio'),onChange:()=>events.push('draw'),stopClip(){bumpers.skip();this.clip=null;},toast:(...args)=>messages.push(args)};
 const bumpers=new ProductionBumpers(tools);Object.assign(bumpers.config,{intro:'intro-id',outro:'outro-id'});return {bumpers,tools,videos,events,messages};
}
test('automatic clips preload authenticated library videos and hold the first frame until the encoder is ready',async t=>{
 const {bumpers,tools,videos,events}=fixture(t);await bumpers.prepare('recording');assert.equal(videos.length,2);assert.equal(videos[0].src,'/api/media/intro-id');assert.equal(videos[1].src,'/api/media/outro-id');assert.equal(bumpers.locked,true);
 bumpers.arm('recording');assert.equal(tools.clip,videos[0]);assert.equal(tools.automaticClip,true);assert.equal(videos[0].paused,true);assert.ok(!events.includes('play'));
 bumpers.start('recording');assert.equal(videos[0].paused,false);videos[0].end();await Promise.resolve();assert.equal(tools.clip,null);assert.equal(tools.automaticClip,false);assert.equal(bumpers.sessions.size,1);
 const ending=bumpers.end('recording');assert.equal(tools.clip,videos[1]);videos[1].end();await ending;
 assert.equal(tools.clip,videos[1],'The final outro frame stays visible until the writer drains');assert.equal(tools.automaticClip,true);bumpers.finish('recording');assert.equal(tools.clip,null);assert.equal(bumpers.locked,false);assert.ok(videos.every(video=>!video.src));
});
test('intro-only, outro-only, neither and disabled output choices do not require the other video',async t=>{
 const {bumpers,videos}=fixture(t);Object.assign(bumpers.config,{intro:'',outro:''});await bumpers.prepare('recording');assert.equal(videos.length,0);
 Object.assign(bumpers.config,{intro:'intro-id',recording:false});await bumpers.prepare('recording');assert.equal(videos.length,0);await bumpers.prepare('live');assert.equal(videos.length,1);bumpers.finish('live');
 Object.assign(bumpers.config,{intro:'',outro:'outro-id',recording:true});await bumpers.prepare('recording');bumpers.arm('recording');assert.equal(bumpers.active,undefined);const end=bumpers.end('recording');videos.at(-1).end();await end;
});
test('skipping an intro restores programme audio and preserves the selected outro',async t=>{
 const {bumpers,tools,videos}=fixture(t);await bumpers.prepare('recording');const intro=bumpers.play('recording','intro');bumpers.skip();await intro;assert.equal(tools.clip,null);assert.equal(videos[0].paused,true);
 const outro=bumpers.end('recording');assert.equal(tools.clip,videos[1]);bumpers.skip();await outro;assert.equal(tools.clip,null);
});
test('device release cancels a pending video load immediately and unlocks the studio',async t=>{
 const {bumpers,videos}=fixture(t,{pending:true});const preparing=bumpers.prepare('live');bumpers.cancel();await assert.rejects(preparing,{name:'AbortError'});assert.equal(bumpers.locked,false);assert.ok(videos.every(video=>!video.src));
});
test('an unavailable or unsupported video rejects preparation before an output can start',async t=>{
 const {bumpers,videos}=fixture(t,{loadError:true});await assert.rejects(bumpers.prepare('recording'),/could not be opened/);assert.equal(bumpers.locked,false);assert.ok(videos.every(video=>!video.src));
});
test('a playback rejection returns to the programme, reports the error and allows stopping',async t=>{
 const {bumpers,tools,messages}=fixture(t,{playError:true});await bumpers.prepare('recording');await bumpers.play('recording','intro');assert.equal(tools.clip,null);assert.equal(messages.length,1);bumpers.finish('recording');assert.equal(bumpers.locked,false);
});
test('live and recording retain independent prepared clips; a new start cannot replace an intro in progress',async t=>{
 const {bumpers,videos}=fixture(t);await bumpers.prepare('recording');await bumpers.prepare('live');assert.equal(videos.length,4);const playing=bumpers.play('recording','intro');await assert.rejects(bumpers.prepare('live'),/Wait/);bumpers.finish('live');assert.equal(bumpers.active.owner,'recording');bumpers.finish('recording');await playing;assert.equal(bumpers.sessions.size,0);
});
test('recorder stop waits for the outro before finalizing once, including concurrent clicks',async()=>{
 let release;const events=[],panel=new RecorderPanel({api(){},toast(){}});panel.id='recording';panel.controls=()=>{};panel.status=()=>{};panel.reloadFiles=async()=>{};
 panel.production={bumpers:{end:()=>{events.push('outro');return new Promise(resolve=>{release=resolve;});},finish:()=>events.push('cleanup')}};panel.stopWriter=async()=>{events.push('writer');panel.id=null;};
 const first=panel.stop(),second=panel.stop();assert.deepEqual(events,['outro']);release();await Promise.all([first,second]);assert.deepEqual(events,['outro','writer','cleanup']);
});
test('forced recorder stop omits the outro and cancels any active clip',async()=>{
 const events=[],panel=new RecorderPanel({api(){},toast(){}});panel.id='recording';panel.controls=()=>{};panel.status=()=>{};panel.reloadFiles=async()=>{};panel.production={bumpers:{end:()=>assert.fail('No outro during failure'),finish:()=>events.push('cancel')}};panel.stopWriter=async()=>{events.push('writer');panel.id=null;};await panel.stop({skipOutro:true});assert.ok(events.indexOf('cancel')<events.indexOf('writer'));
});
test('live stop keeps the broadcast open for the outro and drains its final capture before stopping the destination',async()=>{
 const events=[],panel=new LiveCapturePanel({api:async()=>events.push('remote-stop'),toast(){}});panel.session={id:'live'};panel.controls=()=>{};panel.status=()=>{};panel.element={querySelector:()=>({})};panel.releaseFeed=async()=>events.push('drain');panel.production={bumpers:{sessions:new Map([['live',{}]]),end:async()=>events.push('outro'),finish:()=>events.push('cleanup')}};
 await panel.stop();assert.deepEqual(events.slice(0,3),['outro','drain','remote-stop']);assert.equal(panel.session,null);
});

test('an intro skipped while the encoder is starting cannot restart when the encoder becomes ready',async t=>{
 const {bumpers,tools,videos}=fixture(t);await bumpers.prepare('recording');bumpers.arm('recording');bumpers.skip();bumpers.start('recording');await Promise.resolve();assert.equal(tools.clip,null);assert.equal(videos[0].paused,true);
 const ending=bumpers.end('recording');assert.equal(tools.clip,videos[1]);videos[1].end();await ending;
});
test('automatic intro stays on its first frame until the browser recording actually starts',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'MediaRecorder'),events=[],stream={},status={};let encoder;
 class Recorder extends EventTarget{
  static isTypeSupported(){return true;}
  constructor(){super();encoder=this;this.state='inactive';}
  start(){this.state='recording';events.push('encoder-start-request');}
  stop(){this.state='inactive';queueMicrotask(()=>this.dispatchEvent(new Event('stop')));}
 }
 Object.defineProperty(globalThis,'MediaRecorder',{configurable:true,writable:true,value:Recorder});t.after(()=>{if(previous)Object.defineProperty(globalThis,'MediaRecorder',previous);else delete globalThis.MediaRecorder;});
 const tools=new ProductionTools({getStream:()=>stream,api:async route=>route.endsWith('/start')?{id:'intro-take'}:{},toast:assert.fail});
 tools.element={querySelector:()=>status};tools.update=()=>{};tools.recordingOptions=()=>({directory:'/recordings',askEveryTime:false});
 tools.bumpers={enabled:()=>true,prepare:async()=>{},arm:()=>events.push('hold-first-frame'),start:()=>events.push('play-intro'),finish(){},sessions:new Map()};
 await tools.startRecording();assert.deepEqual(events,['hold-first-frame','encoder-start-request']);encoder.dispatchEvent(new Event('start'));assert.deepEqual(events,['hold-first-frame','encoder-start-request','play-intro']);await tools.stopRecording({skipOutro:true});
});
