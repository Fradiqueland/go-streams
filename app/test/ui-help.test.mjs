import test from 'node:test';
import assert from 'node:assert/strict';
import {helpFor,tooltipPosition,installContextHelp} from '../public/ui-help.js';
import {setLanguage} from '../public/i18n.js';
import {uiHarness} from './ui-harness.mjs';

function control(properties={}){
 const attributes=new Map();return {tagName:'BUTTON',type:'button',dataset:{},textContent:'Control',isConnected:true,
 getAttribute:name=>attributes.get(name)??null,hasAttribute:name=>attributes.has(name),setAttribute:(name,value)=>attributes.set(name,String(value)),removeAttribute:name=>attributes.delete(name),
 closest(selector){if(selector==='form'||selector==='dialog[open]'||selector==='.live-capture-studio')return null;return this;},contains(node){return node===this;},getBoundingClientRect:()=>({left:24,top:30,bottom:74,width:120,height:44}),...properties};
}
function environment(){
 const listeners=new Map(),timers=new Map(),properties=new Map();let sequence=0,observer;
 const body={children:[],appendChild(node){this.children.push(node);node.parentNode=this;}};
 const tip=control({textContent:'',hidden:true,id:'',parentNode:null,getBoundingClientRect:()=>({width:280,height:80})});
 const doc={body,activeElement:null,styleSheets:[{cssRules:[{selectorText:'#control-help',style:{setProperty:(key,value)=>properties.set(key,value)}}]}],createElement:()=>tip,addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);}};
 const win={innerWidth:640,innerHeight:480,addEventListener(){},setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),MutationObserver:class{constructor(fn){observer=fn;}observe(){}}};
 return {doc,win,tip,properties,emit(type,event={}){for(const fn of listeners.get(type)||[])fn(event);},flush(){const callbacks=[...timers.values()];timers.clear();for(const fn of callbacks)fn();},mutate(){observer();}};
}

test('context help clearly distinguishes preparation, preview, recording and public transmission',()=>{
 setLanguage('en',{persist:false});
 assert.match(helpFor(control({dataset:{action:'go-live'}})),/Nothing is broadcast until you confirm/);
 assert.match(helpFor(control({dataset:{capture:'preview'}})),/never broadcasts/);
 assert.match(helpFor(control({dataset:{production:'record'}})),/does not start a public broadcast/);
 assert.match(helpFor(control({dataset:{capture:'start'},disabled:true})),/preview.*destination.*confirmation/);
 setLanguage('pt-PT',{persist:false});assert.match(helpFor(control({dataset:{production:'choose-recording-folder'}})),/não inicia a gravação/);
});

test('help uses purpose and labels without reading passwords or stream-key values',()=>{
 setLanguage('en',{persist:false});
 for(const name of ['password','key']){
  const field=control({tagName:'INPUT',name});Object.defineProperty(field,'value',{get(){throw Error('Secret value must not be read');}});
  assert.ok(helpFor(field));
 }
 const form={classList:{contains:cls=>cls==='chat-compose'}};assert.match(helpFor(control({type:'submit',form})),/Viewers.*can see/);
 assert.match(helpFor(control({dataset:{chat:'reply'}})),/write and send/);
});

test('tooltip placement stays inside small viewports and flips above a low trigger',()=>{
 let position=tooltipPosition({left:350,top:650,bottom:694,width:35},{width:300,height:90},{width:390,height:720});assert.ok(position.left>=12&&position.left+300<=378);assert.ok(position.top+90<650);
 position=tooltipPosition({left:0,top:0,bottom:44,width:44},{width:300,height:70},{width:160,height:120});assert.ok(position.left>=12&&position.top>=12);
});

test('keyboard help adds its own description, dismisses with Escape and preserves existing accessibility metadata',()=>{
 const e=environment(),installed=installContextHelp(e.doc,e.win),button=control({dataset:{action:'go-live'}});button.setAttribute('title','Original title');button.setAttribute('aria-describedby','existing-note');e.doc.activeElement=button;
 e.emit('focusin',{target:button});assert.equal(e.tip.hidden,false);assert.equal(button.getAttribute('aria-describedby'),'existing-note control-help');assert.equal(button.hasAttribute('title'),false);assert.ok(e.properties.has('left'));
 assert.equal(installed.isReading(),true);
 let prevented=false,stopped=false;e.emit('keydown',{key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
 assert.ok(prevented&&stopped);assert.equal(e.tip.hidden,true);assert.equal(button.getAttribute('title'),'Original title');assert.equal(button.getAttribute('aria-describedby'),'existing-note');
 assert.equal(installed.isReading(),false);
 e.emit('focusin',{target:button});assert.equal(e.tip.hidden,true);assert.equal(installContextHelp(e.doc,e.win),installed);assert.equal(e.doc.body.children.length,1);
});

test('tooltip stays hoverable and is removed when its trigger is replaced',()=>{
 const e=environment();installContextHelp(e.doc,e.win);const button=control({dataset:{capture:'preview'}});
 e.emit('pointerover',{target:button,pointerType:'mouse'});assert.equal(e.tip.hidden,true);e.flush();assert.equal(e.tip.hidden,false);
 e.emit('pointerout',{target:button,relatedTarget:e.tip});e.flush();assert.equal(e.tip.hidden,false);
 button.isConnected=false;e.mutate();assert.equal(e.tip.hidden,true);assert.equal(button.getAttribute('aria-describedby'),null);
});

test('dialog help is placed in the top-layer dialog and renders text without HTML interpretation',()=>{
 const e=environment(),dialog={appendChild(node){node.parentNode=this;}};installContextHelp(e.doc,e.win);
 const button=control({dataset:{help:'<img onerror=alert(1)> details'}}),closest=button.closest.bind(button);button.closest=selector=>selector==='dialog[open]'?dialog:closest(selector);
 e.emit('focusin',{target:button});assert.equal(e.tip.parentNode,dialog);assert.equal(e.tip.textContent,'<img onerror=alert(1)> details');assert.equal(e.tip.getAttribute('role'),'tooltip');
});

test('dashboard offers distinct live and prepared-video entry points and explains missing destinations',()=>{
 const h=uiHarness({locale:'en'});let html=h.run('dashboard()');assert.match(html,/Open live studio/);assert.match(html,/Prepared videos or playlists/);assert.match(html,/First time/);
 h.run("state.channels=[{id:'c',hasKey:false}]");html=h.run('dashboard()');assert.match(html,/missing stream keys/);assert.ok(!html.includes('undefined'));
 h.run("state.channels[0].hasKey=true");assert.match(h.run('dashboard()'),/destinations are configured/);
});

test('scrolling long help preserves it while scrolling the surrounding page dismisses it',()=>{
 const e=environment();installContextHelp(e.doc,e.win);const button=control({dataset:{help:'Long explanation '.repeat(100)}});
 e.emit('focusin',{target:button});e.emit('scroll',{target:e.tip});assert.equal(e.tip.hidden,false);
 e.emit('scroll',{target:e.doc.body});assert.equal(e.tip.hidden,true);
});

test('changed prerequisites reposition help and respect the usable viewport width',()=>{
 setLanguage('en',{persist:false});const e=environment();e.doc.documentElement={clientWidth:300};e.win.innerHeight=240;
 e.tip.getBoundingClientRect=()=>({width:276,height:e.tip.textContent.includes('free destination')?140:50});
 const button=control({dataset:{capture:'start'},disabled:false,getBoundingClientRect:()=>({left:220,top:170,bottom:214,width:80,height:44})});
 installContextHelp(e.doc,e.win);e.emit('focusin',{target:button});const before=Number.parseFloat(e.properties.get('top'));
 button.disabled=true;e.mutate();assert.ok(Number.parseFloat(e.properties.get('top'))<before);assert.equal(e.properties.get('max-width'),'276px');assert.equal(e.properties.get('max-height'),'216px');
 assert.ok(Number.parseFloat(e.properties.get('top'))+140<=228);
});

test('project export help distinguishes configuration from media and protected keys',()=>{
 setLanguage('en',{persist:false});const link=control({tagName:'A'});link.setAttribute('href','/api/export');assert.match(helpFor(link),/without stream keys.*Video files are not included/);
});
