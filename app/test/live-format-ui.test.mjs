import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveCapturePanel} from '../public/live-capture.js';
import {videoAspects} from '../public/video-geometry.js';

function global(t,name,value){
 const previous=Object.getOwnPropertyDescriptor(globalThis,name);
 Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});
}
function preview(t,{aspect='16:9',quality='720p'}={}){
 const requests=[],draws=[],fields=Object.fromEntries(Object.entries({aspect,quality,source:'camera',camera:'',microphone:'',useMic:'',systemAudio:''}).map(([name,value])=>[name,{name,value,checked:true}]));
 const controls={},status={},video={},size={};
 class Track extends EventTarget{constructor(kind){super();this.kind=kind;this.readyState='live';}stop(){this.readyState='ended';}}
 class Stream{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}}
 const source=new Stream([new Track('video'),new Track('audio')]);
 const node=()=>({gain:{value:1},connect(target){return target;},disconnect(){},start(){}});
 global(t,'MediaRecorder',class{static isTypeSupported(){return true;}});global(t,'window',{MediaRecorder});global(t,'MediaStream',Stream);
 global(t,'navigator',{mediaDevices:{async getUserMedia(options){requests.push(options);return source;},getDisplayMedia(){assert.fail('Camera preview must not request a screen');}}});
 global(t,'FormData',class{get(name){return fields[name]?.value||'';}has(name){return Boolean(fields[name]?.checked);}});
 global(t,'document',{createElement:tag=>tag==='video'?{videoWidth:640,videoHeight:360,async play(){},pause(){}}:{getContext:()=>({}),captureStream:()=>new Stream([new Track('video')])}});
 global(t,'AudioContext',class{destination=node();async resume(){}async close(){}createMediaStreamDestination(){return {stream:new Stream([new Track('audio')])};}createGain(){return node();}createAnalyser(){return {...node(),fftSize:32};}createOscillator(){return node();}createMediaStreamSource(){return node();}});
 global(t,'setInterval',()=>1);global(t,'clearInterval',()=>{});
 const panel=new LiveCapturePanel({api(){assert.fail('Preview must not contact broadcasting API');},toast(){},getState:()=>({})});
 panel.element={
  querySelector(selector){
   const field=/\[name="([^"]+)"\]/.exec(selector);if(field)return fields[field[1]];
   if(selector==='.capture-status')return status;if(selector==='.capture-preview')return video;if(selector==='.capture-frame-size')return size;
   return controls[selector]||=(selector.includes('consent')?{checked:true}:{});
  },
  querySelectorAll:()=>Object.values(fields)
 };
 panel.production={recording:false,draw(_ctx,width,height){draws.push([width,height]);},update(){},element:{querySelector:()=>({value:'1'})}};
 panel.listDevices=async()=>{};
 t.after(()=>panel.releaseDevices());
 return {panel,fields,requests,draws,size,source};
}

test('live preview changes all supported shapes and quality without reopening devices or replacing the stream',async t=>{
 const {panel,fields,requests,draws,size}=preview(t);await panel.preview();
 const stream=panel.output,tracks=stream.getTracks();assert.equal(requests.length,1);
 const sizes={'16:9':[1280,720],'9:16':[720,1280],'1:1':[720,720],'4:3':[960,720],'3:4':[720,960],'21:9':[1680,720]};
 for(const aspect of videoAspects){
  fields.aspect.value=aspect;assert.equal(panel.changeFormat('aspect',aspect),true);
  assert.deepEqual([panel.canvas.width,panel.canvas.height],sizes[aspect]);assert.deepEqual(draws.at(-1),sizes[aspect]);
  assert.equal(panel.config.aspect,aspect);assert.equal(size.textContent,sizes[aspect].join(' × '));assert.equal(panel.output,stream);assert.deepEqual(panel.output.getTracks(),tracks);
 }
 fields.quality.value='1080p';assert.equal(panel.changeFormat('quality','1080p'),true);assert.deepEqual([panel.canvas.width,panel.canvas.height],[2520,1080]);
 assert.equal(requests.length,1);assert.ok(tracks.every(track=>track.readyState==='live'));
 panel.controls();assert.equal(fields.aspect.disabled,false);assert.equal(fields.quality.disabled,false);assert.equal(fields.source.disabled,true);
});

test('live geometry stays locked through live, shared-feed and local-recording transitions, including stale changes',async t=>{
 const {panel,fields}=preview(t);await panel.preview();
 for(const phase of ['preparing','stopping','releasing','session','feedStarting','feedSession','feedClosing','recording']){
  if(phase==='recording')panel.production.recording=true;else panel[phase]=true;
  panel.syncFormatControls();assert.equal(fields.aspect.disabled,true,phase);assert.equal(fields.quality.disabled,true,phase);
  fields.aspect.value='1:1';fields.quality.value='1080p';assert.equal(panel.changeFormat('aspect','1:1'),false,phase);assert.equal(panel.changeFormat('quality','1080p'),false,phase);
  assert.equal(fields.aspect.value,'16:9');assert.equal(fields.quality.value,'720p');assert.deepEqual([panel.canvas.width,panel.canvas.height],[1280,720]);
  assert.deepEqual(panel.config,{source:'camera',quality:'720p',aspect:'16:9'});
  if(phase==='recording')panel.production.recording=false;else panel[phase]=false;
 }
 panel.syncFormatControls();assert.equal(fields.aspect.disabled,false);assert.equal(fields.quality.disabled,false);
});

test('invalid live format changes preserve the prepared configuration and frame',async t=>{
 const {panel,fields}=preview(t);await panel.preview();
 fields.aspect.value='original';assert.equal(panel.changeFormat('aspect','original'),false);assert.equal(fields.aspect.value,'16:9');
 fields.quality.value='4K';assert.equal(panel.changeFormat('quality','4K'),false);assert.equal(fields.quality.value,'720p');
 assert.equal(panel.changeFormat('source','screen'),false);assert.deepEqual([panel.canvas.width,panel.canvas.height],[1280,720]);assert.equal(panel.config.source,'camera');
});

test('unsupported live format is rejected before requesting devices',async t=>{
 const {panel,requests}=preview(t,{aspect:'original'});await panel.preview();
 assert.equal(requests.length,0);assert.equal(panel.output,null);assert.equal(panel.preparing,false);assert.match(panel.element.querySelector('.capture-status').textContent,/supported live video format/);
});
