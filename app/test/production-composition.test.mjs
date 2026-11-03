import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionTools} from '../public/live-production.js';

function replaceGlobal(t,name,value){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}
function storage(t){const values=new Map();replaceGlobal(t,'localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)});return values;}
function fieldsElement(fields){return {isConnected:true,hidden:false,getClientRects:()=>[{}],querySelector:selector=>fields[/\[name(?:=|=")([^\]"=]+)"?\]/.exec(selector)?.[1]]||null};}
function sceneTools(options={}){const tools=new ProductionTools({recordingControls:false,toast(){},...options}),fields={scene:{value:'intro'}};tools.element=fieldsElement(fields);return {tools,fields};}
function drawContext(events){return {fillStyle:'',fillRect(...args){events.push(['fill',this.fillStyle,...args]);},drawImage(image,...args){events.push(['image',image.id,...args]);},save(){events.push(['save']);},restore(){events.push(['restore']);},translate(...args){events.push(['translate',...args]);},scale(...args){events.push(['scale',...args]);},fillText(value,...args){events.push(['text',value,...args]);},measureText:()=>({width:100})};}

test('recorder base composition remains between background and clip, with production graphics above both',()=>{
 const events=[],ctx=drawContext(events),tools=new ProductionTools({});
 tools.values={...tools.values,background:'#123456',accent:'#abcdef',name:'Presenter',title:'Title',banner:'Banner 🎵',ticker:'Ticker 😀'};
 tools.images={backgroundImage:{id:'background'},logo:{id:'logo',width:200,height:100}};tools.clip={id:'clip',paused:false,ended:false};
 const camera={id:'camera'},screen={id:'screen'};
 tools.draw(ctx,1280,720,camera,screen,(source,...rect)=>events.push(['fit',source.id,...rect]),(_ctx,w,h,values)=>{assert.equal(_ctx,ctx);assert.deepEqual([w,h],[1280,720]);assert.equal(values.layout,'pip');events.push(['cropped-base']);});
 const base=events.findIndex(e=>e[0]==='cropped-base'),background=events.findIndex(e=>e[0]==='image'&&e[1]==='background'),clip=events.findIndex(e=>e[0]==='fit'&&e[1]==='clip'),logo=events.findIndex(e=>e[0]==='image'&&e[1]==='logo');
 assert.deepEqual(events[0],['fill','#123456',0,0,1280,720]);assert.ok(background<base&&base<clip&&clip<logo);
 assert.ok(events.filter(e=>e[0]==='text').every(e=>events.indexOf(e)>logo));assert.deepEqual(events.filter(e=>e[0]==='text').map(e=>e[1]),['Presenter \u2014 Title','Banner 🎵','Ticker 😀']);
 assert.deepEqual(events.filter(e=>e[0]==='fit').map(e=>e[1]),['clip'],'Custom cropped camera/screen composition must not be redrawn by the default layout');
});

test('existing live composition keeps default layouts and camera-only mirroring when no custom base is supplied',()=>{
 const events=[],tools=new ProductionTools({}),ctx=drawContext(events),camera={id:'camera'},screen={id:'screen'};tools.values.mirror=true;
 tools.draw(ctx,1000,600,camera,screen,(source,...rect)=>events.push(['fit',source.id,...rect]));
 assert.deepEqual(events.filter(e=>e[0]==='fit'),[['fit','screen',0,0,1000,600],['fit','camera',0,0,280,168.00000000000003]]);
 assert.deepEqual(events.filter(e=>e[0]==='scale'),[['scale',-1,1]]);assert.equal(events.filter(e=>e[0]==='save').length,2);assert.equal(events.filter(e=>e[0]==='restore').length,2);
});

test('visual-only mode needs no recording controls, feed API or folder state',()=>{
 const states=[],tools=new ProductionTools({recordingControls:false,onRecordingStateChange:state=>states.push(state),getStream:()=>assert.fail('Visual update cannot acquire a recording stream')});
 tools.element={querySelector:()=>assert.fail('Visual update cannot query the absent recording section')};tools.update([{id:'unrelated',status:'recording'}],{directory:'do not apply',askEveryTime:false});tools.update();
 assert.deepEqual(states,[false]);assert.equal(tools.recordingPreferences.directory,'');assert.equal(tools.recordingId,undefined);
});

test('only the connected visible production panel handles layout and external recording shortcuts',async()=>{
 const calls=[],first=new ProductionTools({recordingControls:false,getStream:()=>({}),toggleRecording:()=>calls.push('first'),onChange:()=>calls.push('layout-first')}),second=new ProductionTools({recordingControls:false,getStream:()=>({}),toggleRecording:()=>calls.push('second'),onChange:()=>calls.push('layout-second')});
 const firstLayout={},secondLayout={};first.element=fieldsElement({layout:firstLayout});second.element=fieldsElement({layout:secondLayout});first.element.isConnected=false;
 const event={ctrlKey:true,altKey:true,key:'4',preventDefault:()=>calls.push('prevent')};first.handleKeydown(event);second.handleKeydown(event);
 assert.equal(first.values.layout,'pip');assert.equal(second.values.layout,'split');assert.equal(secondLayout.value,'split');assert.deepEqual(calls,['prevent','layout-second']);
 calls.length=0;const record={...event,key:'r',code:'KeyR'};first.handleKeydown(record);second.handleKeydown(record);await Promise.resolve();assert.deepEqual(calls,['prevent','second']);
 calls.length=0;second.element.getClientRects=()=>[];second.handleKeydown(record);second.element.getClientRects=()=>[{}];second.handleKeydown({...record,repeat:true});second.handleKeydown({...record,isComposing:true});assert.deepEqual(calls,[]);
});

test('recording-state callbacks follow pending start and finalization without polling notifications',()=>{
 const states=[],tools=new ProductionTools({recordingControls:false,onRecordingStateChange:state=>states.push(state)});tools.element={};
 tools.update();tools.starting=true;tools.update();tools.update();tools.starting=false;tools.recordingId='record';tools.update();tools.finishing={};tools.recordingId=null;tools.update();tools.finishing=null;tools.update();tools.update();
 assert.deepEqual(states,[false,true,false]);
});

test('scene saves merge the latest stored map and loads observe another panel update',async t=>{
 const saved=storage(t),a=sceneTools(),b=sceneTools();a.tools.values.banner='First';await a.tools.action({dataset:{production:'save-scene'}});
 b.fields.scene.value='main';b.tools.values.ticker='Second 🎵';await b.tools.action({dataset:{production:'save-scene'}});
 const result=JSON.parse(saved.get('go-streams-scenes'));assert.deepEqual(Object.keys(result).sort(),['intro','main']);assert.equal(result.intro.banner,'First');assert.equal(result.main.ticker,'Second 🎵');
 a.fields.scene.value='main';await a.tools.action({dataset:{production:'load-scene'}});assert.equal(a.tools.values.ticker,'Second 🎵');
 b.tools.values.banner='Updated';await b.tools.action({dataset:{production:'save-scene'}});await a.tools.action({dataset:{production:'load-scene'}});assert.equal(a.tools.values.banner,'Updated');
});

test('a recorder scene namespace preserves compatible live scenes without overwriting them',async t=>{
 const saved=storage(t);saved.set('go-streams-scenes',JSON.stringify({intro:{banner:'Existing live scene',background:'#202020'}}));
 const recorder=sceneTools({sceneStorageKey:'go-streams-recorder-scenes'});recorder.tools.values.banner='Recorder scene';await recorder.tools.action({dataset:{production:'save-scene'}});
 const live=sceneTools();await live.tools.action({dataset:{production:'load-scene'}});assert.equal(live.tools.values.banner,'Existing live scene');assert.equal(live.tools.values.background,'#202020');assert.equal(JSON.parse(saved.get('go-streams-recorder-scenes')).intro.banner,'Recorder scene');
});

function textField(name,value,maxLength=160){return {name,value,maxLength,selectionStart:0,selectionEnd:0,setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.selectionStart=this.selectionEnd=start+text.length;},dispatchEvent(event){this.lastInput=event;},focus(){this.focused=true;}};}
test('emoji insertion replaces the last selected text, restores the caret and uses the explicitly chosen target',()=>{
 const banner=textField('banner','Hello OLD world'),ticker=textField('ticker','News'),target={value:'banner'},tools=new ProductionTools({});tools.element=fieldsElement({banner,ticker,emojiTarget:target});
 banner.selectionStart=6;banner.selectionEnd=9;tools.rememberTextSelection(banner);tools.insertEmoji('🎵');
 assert.equal(banner.value,'Hello 🎵 world');assert.equal(tools.values.banner,banner.value);assert.deepEqual([banner.selectionStart,banner.selectionEnd],[8,8]);assert.equal(banner.lastInput.type,'input');assert.equal(banner.lastInput.bubbles,true);assert.equal(banner.focused,true);
 target.value='ticker';tools.insertEmoji('😀');assert.equal(ticker.value,'News😀');assert.equal(banner.value,'Hello 🎵 world');assert.equal(tools.values.ticker,'News😀');
});

test('emoji insertion respects native UTF-16 maxlength without cutting an emoji in half',()=>{
 const messages=[],field=textField('banner','abcd',5),tools=new ProductionTools({toast:message=>messages.push(message)});tools.element=fieldsElement({banner:field,emojiTarget:{value:'banner'}});
 field.selectionStart=field.selectionEnd=4;tools.rememberTextSelection(field);tools.insertEmoji('😀');assert.equal(field.value,'abcd');assert.equal(messages.length,1);assert.equal(field.lastInput,undefined);
 field.selectionStart=3;field.selectionEnd=4;tools.rememberTextSelection(field);tools.insertEmoji('😀');assert.equal(field.value,'abc😀');assert.equal(field.value.length,5);assert.equal(messages.length,1);
});

test('stopping visual production releases clips, URLs and teleprompter timers while retaining scene settings',t=>{
 const calls=[],tools=new ProductionTools({setClipAudio:value=>calls.push(['audio',value]),onChange:()=>calls.push(['change'])});
 replaceGlobal(t,'clearInterval',id=>calls.push(['timer',id]));t.mock.method(URL,'revokeObjectURL',url=>calls.push(['revoke',url]));
 tools.values.banner='Keep this';tools.scrollTimer=77;const clip=tools.clip={onended(){},onerror(){},src:'blob:test',pause(){calls.push(['pause']);}};tools.clipUrl='blob:test';tools.stopVisuals();tools.stopVisuals();
 assert.equal(tools.scrollTimer,null);assert.equal(tools.clip,null);assert.equal(tools.clipUrl,null);assert.equal(clip.src,'');assert.equal(clip.onended,null);assert.equal(clip.onerror,null);assert.equal(tools.values.banner,'Keep this');assert.deepEqual(calls.filter(c=>c[0]==='timer'),[['timer',77]]);assert.deepEqual(calls.filter(c=>c[0]==='revoke'),[['revoke','blob:test']]);assert.ok(calls.some(c=>c[0]==='audio'&&c[1]===null));
});
