import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionTools} from '../public/live-production.js';
import {RecorderPanel} from '../public/recorder.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function replaceGlobal(t,name,value){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}
function fixture(t,{width=600,height=300}={}){
 const saved=new Map(),readers=[],images=[],canvases=[],messages=[],fields={scene:{value:'intro'},logo:{type:'file',value:''},backgroundImage:{type:'file',value:''}};
 replaceGlobal(t,'localStorage',{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)});
 replaceGlobal(t,'FileReader',class{readAsDataURL(file){this.result=file.data;readers.push(this);}});
 replaceGlobal(t,'Image',class{constructor(){this.width=width;this.height=height;this.ready=deferred();images.push(this);}decode(){return this.ready.promise;}});
 replaceGlobal(t,'document',{createElement(tag){assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext:()=>({drawImage(source){canvas.source=source;}}),toDataURL:(format,quality)=>{canvas.format=format;canvas.quality=quality;return canvas.width&&canvas.height?'data:'+format+';base64,Y2FudmFz':'data:,';}};canvases.push(canvas);return canvas;}});
 const tools=new ProductionTools({recordingControls:false,toast:(message,error)=>messages.push({message,error})});
 tools.element={querySelector:selector=>fields[/\[name(?:=|=")([^\]"=]+)"?\]/.exec(selector)?.[1]]||null};
 return {tools,saved,readers,images,canvases,messages,fields};
}
const imageFile=name=>({type:'image/png',size:100,data:'data:image/png;base64,'+name});
async function beginDecode(f,index=0){f.readers[index].onload();await Promise.resolve();}

test('scene save waits for the selected image, preserves later text and merges other saved scenes',async t=>{
 const f=fixture(t),loading=f.tools.loadImage('logo',imageFile('first')),button={dataset:{production:'save-scene'}};
 const saving=f.tools.action(button);assert.equal(button.disabled,true);assert.equal(f.saved.has('go-streams-scenes'),false);assert.equal(f.tools.hasUnsavedChanges,true);
 f.tools.values.banner='Edited while the image loaded';f.fields.scene.value='main';f.saved.set('go-streams-scenes',JSON.stringify({outro:{banner:'Saved elsewhere'}}));
 await beginDecode(f);assert.equal(f.saved.has('go-streams-scenes'),true);assert.equal(JSON.parse(f.saved.get('go-streams-scenes')).intro,undefined);
 f.images[0].ready.resolve();await loading;await saving;
 const scenes=JSON.parse(f.saved.get('go-streams-scenes'));assert.equal(scenes.intro.logo,f.tools.values.logo);assert.equal(scenes.intro.banner,'Edited while the image loaded');assert.equal(scenes.outro.banner,'Saved elsewhere');assert.equal(scenes.main,undefined);
 assert.equal(f.tools.values.banner,'Edited while the image loaded');assert.equal(f.tools.images.logo,f.canvases[0]);assert.equal(button.disabled,false);assert.equal(f.tools.hasUnsavedChanges,false);
});

test('failed pending image does not report a scene saved or replace existing stored scenes',async t=>{
 const f=fixture(t),original=JSON.stringify({intro:{banner:'Keep this scene'}});f.saved.set('go-streams-scenes',original);
 const loading=f.tools.loadImage('logo',imageFile('broken')),button={dataset:{production:'save-scene'}},saving=f.tools.action(button);await beginDecode(f);f.images[0].ready.reject(Error('Invalid image'));await loading;await saving;
 assert.equal(f.saved.get('go-streams-scenes'),original);assert.equal(button.disabled,false);assert.ok(f.messages.some(message=>message.error&&/image/i.test(message.message)));assert.equal(f.messages.some(message=>!message.error&&/saved/i.test(message.message)),false);
});

test('saving during a replaced image request waits for the latest image and ignores the obsolete failure',async t=>{
 const f=fixture(t),old=f.tools.loadImage('logo',imageFile('old')),saving=f.tools.action({dataset:{production:'save-scene'}});
 const latest=f.tools.loadImage('logo',imageFile('latest'));f.readers[0].onerror(Error('Obsolete read failed'));await old;await Promise.resolve();assert.equal(f.saved.size,0);
 await beginDecode(f,1);f.images[0].ready.resolve();await latest;await saving;
 assert.equal(f.tools.images.logo.source.src,imageFile('latest').data);assert.equal(JSON.parse(f.saved.get('go-streams-scenes')).intro.logo,f.tools.values.logo);assert.equal(f.messages.some(message=>message.error),false);
});

test('clearing images while a save waits cannot restore a stale image or its saved data',async t=>{
 const f=fixture(t),loading=f.tools.loadImage('logo',imageFile('old')),saving=f.tools.action({dataset:{production:'save-scene'}});
 await f.tools.action({dataset:{production:'clear-images'}});await beginDecode(f);await loading;await saving;
 assert.equal(f.images.length,0);assert.deepEqual(f.tools.images,{});assert.equal(f.tools.values.logo,'');assert.equal(JSON.parse(f.saved.get('go-streams-scenes')).intro.logo,'');assert.equal(f.tools.hasUnsavedChanges,false);
});

for(const [width,height,expected]of [[6000,1,[600,1]],[1,6000,[1,600]]])test('very narrow image stays valid after bounded resizing: '+width+'x'+height,async t=>{
 const f=fixture(t,{width,height}),loading=f.tools.loadImage('logo',imageFile('thin'));await beginDecode(f);f.images[0].ready.resolve();await loading;
 assert.deepEqual([f.canvases[0].width,f.canvases[0].height],expected);assert.equal(f.tools.images.logo,f.canvases[0]);assert.match(f.tools.values.logo,/^data:image\/png;base64,/);assert.equal(f.messages.length,0);
});

test('visual composition drafts become clean only after successful scene save or load and reach the recorder guard',async t=>{
 const f=fixture(t),panel=new RecorderPanel({});panel.production=f.tools;
 assert.equal(f.tools.hasUnsavedChanges,false);assert.equal(panel.hasUnsavedChanges,false);f.tools.values.banner='Saved banner';assert.equal(panel.hasUnsavedChanges,true);
 await f.tools.action({dataset:{production:'save-scene'}});assert.equal(panel.hasUnsavedChanges,false);f.tools.values.banner='Draft';assert.equal(panel.hasUnsavedChanges,true);
 await f.tools.action({dataset:{production:'load-scene'}});assert.equal(f.tools.values.banner,'Saved banner');assert.equal(panel.hasUnsavedChanges,false);
 f.tools.values.ticker='Unsaved ticker';const save=localStorage.setItem;localStorage.setItem=()=>{throw Error('Quota exceeded');};await f.tools.action({dataset:{production:'save-scene'}});localStorage.setItem=save;assert.equal(panel.hasUnsavedChanges,true);
});

for(const changed of ['closed','replaced'])test('local recording rejects a '+changed+' preview while backend recording creation is pending',async t=>{
 const previous=globalThis.MediaRecorder;globalThis.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){assert.fail('A stale preview cannot create a browser recorder');}};t.after(()=>{if(previous===undefined)delete globalThis.MediaRecorder;else globalThis.MediaRecorder=previous;});
 let stream={};const pending=deferred(),requests=[],messages=[],tools=new ProductionTools({getStream:()=>stream,api:async(route,body)=>{requests.push({route,body});return route==='/api/recordings/start'?pending.promise:{};},toast:message=>messages.push(message)});
 tools.recordingOptions=()=>({directory:'/chosen/recordings',askEveryTime:false});tools.update=()=>{};tools.element={querySelector:()=>({})};const starting=tools.startRecording();stream=changed==='closed'?null:{};pending.resolve({id:'stale'});await starting;
 assert.deepEqual(requests,[{route:'/api/recordings/start',body:{confirmed:true,directory:'/chosen/recordings',kind:'video',format:'mp4',context:'live'}},{route:'/api/recordings/stale/finish',body:{discardEmpty:true}}]);assert.equal(tools.recordingId,null);assert.equal(tools.starting,false);assert.equal(tools.startDone,null);assert.ok(messages.some(message=>/preview changed/i.test(message)));
});

for(const format of ['image/png','image/webp','image/jpeg'])test('background scene preserves image encoding and transparency support: '+format,async t=>{
 const f=fixture(t),file={type:format,size:100,data:'data:'+format+';base64,YmFja2dyb3VuZA=='},loading=f.tools.loadImage('backgroundImage',file);
 await beginDecode(f);f.images[0].ready.resolve();await loading;await f.tools.action({dataset:{production:'save-scene'}});
 assert.equal(f.canvases[0].format,format);assert.equal(f.canvases[0].quality,.85);assert.equal(f.tools.images.backgroundImage,f.canvases[0]);
 const persisted=JSON.parse(f.saved.get('go-streams-scenes')).intro.backgroundImage;assert.equal(persisted,'data:'+format+';base64,Y2FudmFz');
 const reloading=f.tools.action({dataset:{production:'load-scene'}});assert.equal(f.images[1].src,persisted);f.images[1].ready.resolve();await reloading;
 assert.equal(f.tools.images.backgroundImage,f.images[1]);assert.equal(f.tools.hasUnsavedChanges,false);
});

for(const loadedScene of ['main','intro'])test('loading '+loadedScene+' invalidates an earlier scene save still waiting for an image',async t=>{
 const f=fixture(t),original=JSON.stringify({intro:{banner:'Original Intro'},main:{banner:'Saved Main'}});f.saved.set('go-streams-scenes',original);
 f.tools.values.banner='Draft intended for Intro';
 const loading=f.tools.loadImage('logo',imageFile('pending')),button={dataset:{production:'save-scene'}},saving=f.tools.action(button);
 f.fields.scene.value=loadedScene;await f.tools.action({dataset:{production:'load-scene'}});
 f.readers[0].onload();await loading;await saving;
 assert.equal(f.saved.get('go-streams-scenes'),original);
 assert.equal(f.tools.values.banner,loadedScene==='main'?'Saved Main':'Original Intro');
 assert.equal(f.tools.hasUnsavedChanges,false);assert.equal(button.disabled,false);
 assert.ok(f.messages.some(message=>message.error&&/scene changed/i.test(message.message)));
 assert.equal(f.messages.some(message=>!message.error&&/saved/i.test(message.message)),false);
});

for(const [format,extension]of [['mp4','mp4'],['webm','webm'],[undefined,'webm']])test('live recording download names match the '+extension+' file format'+(format?'':' for legacy records'),()=>{
 const fields=new Map(),tools=new ProductionTools({getStream:()=>null});
 tools.element={querySelector:selector=>{if(!fields.has(selector))fields.set(selector,{});return fields.get(selector);}};
 tools.update([{id:'local-take',created:'2026-11-02T00:00:00Z',status:'completed',bytes:1048576,...(format?{format}:{})}]);
 const html=fields.get('.recording-files').innerHTML;
 assert.ok(html.includes('href="/api/recordings/local-take/file"'));
 assert.ok(html.includes('download="Streamland-local-take.'+extension+'"'));
});

test('live recording download attributes escape file identifiers and formats',()=>{
 const fields=new Map(),tools=new ProductionTools({getStream:()=>null});
 tools.element={querySelector:selector=>{if(!fields.has(selector))fields.set(selector,{});return fields.get(selector);}};
 tools.update([{id:'take"one',format:'webm"test',created:'2026-11-02T00:00:00Z',status:'completed',bytes:1}]);
 assert.ok(fields.get('.recording-files').innerHTML.includes('download="Streamland-take&quot;one.webm&quot;test"'));
});

test('loading an empty scene slot does not cancel a pending save to a valid slot',async t=>{
 const f=fixture(t);f.tools.values.banner='Intro draft';
 const loading=f.tools.loadImage('logo',imageFile('pending')),saving=f.tools.action({dataset:{production:'save-scene'}});
 f.fields.scene.value='main';await f.tools.action({dataset:{production:'load-scene'}});
 await beginDecode(f);f.images[0].ready.resolve();await loading;await saving;
 assert.equal(JSON.parse(f.saved.get('go-streams-scenes')).intro.banner,'Intro draft');
 assert.equal(f.tools.hasUnsavedChanges,false);
 assert.ok(f.messages.some(message=>!message.error&&/saved/i.test(message.message)));
 assert.equal(f.messages.some(message=>message.error&&/scene changed/i.test(message.message)),false);
});
