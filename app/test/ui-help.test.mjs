import test from 'node:test';
import assert from 'node:assert/strict';
import {helpFor,tooltipPosition,installContextHelp} from '../public/ui-help.js';
import {setLanguage} from '../public/i18n.js';
import {uiHarness} from './ui-harness.mjs';

function control(properties={}){
 const attributes=new Map();let text='Control',classes='',connected=true;
 const node={tagName:'BUTTON',type:'button',dataset:{},children:[],parentNode:null,hidden:false,
  get parentElement(){return this.parentNode;},get isConnected(){return connected&&(this.parentNode?this.parentNode.isConnected!==false:true);},set isConnected(value){connected=value;},
  get textContent(){return text+this.children.map(child=>child.textContent).join('');},set textContent(value){text=String(value);this.children=[];},
  get className(){return classes;},set className(value){classes=value;},get labels(){const label=this.closest('label');return label?[label]:[];},
  classList:{contains:name=>classes.split(/\s+/).includes(name),add(...names){classes=[...new Set([...classes.split(/\s+/).filter(Boolean),...names])].join(' ');}},
  getAttribute:name=>attributes.get(name)??null,hasAttribute:name=>attributes.has(name),setAttribute:(name,value)=>attributes.set(name,String(value)),removeAttribute:name=>attributes.delete(name),
  matches(selector){return selector.split(',').some(value=>{value=value.trim();return value.startsWith('#')?this.id===value.slice(1):value.startsWith('.')?this.classList.contains(value.slice(1)):value==='[aria-hidden="true"]'?this.getAttribute('aria-hidden')==='true':value==='dialog[open]'?this.tagName==='DIALOG'&&this.open:this.tagName.toLowerCase()===value;});},
  closest(selector){for(let item=this;item;item=item.parentNode)if(item.matches?.(selector))return item;return null;},
  contains(other){return this===other||this.children.some(child=>child.contains(other));},
  appendChild(child){if(child.parentNode)child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);child.parentNode=this;child.isConnected=true;this.children.push(child);return child;},
  before(other){const parent=this.parentNode;if(!parent)return;if(other.parentNode)other.parentNode.children.splice(other.parentNode.children.indexOf(other),1);other.parentNode=parent;other.isConnected=true;parent.children.splice(parent.children.indexOf(this),0,other);},
  after(other){const parent=this.parentNode;if(!parent)return;if(other.parentNode)other.parentNode.children.splice(other.parentNode.children.indexOf(other),1);other.parentNode=parent;other.isConnected=true;parent.children.splice(parent.children.indexOf(this)+1,0,other);},
  remove(){if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;this.isConnected=false;},replaceWith(other){this.before(other);this.remove();},
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
  cloneNode(deep){const clone=control({tagName:this.tagName,className:this.className,textContent:text});for(const [key,value]of attributes)clone.setAttribute(key,value);if(deep)for(const child of this.children)clone.appendChild(child.cloneNode(true));return clone;},
  focus(){},getBoundingClientRect:()=>({left:24,top:30,bottom:74,width:120,height:44})};Object.assign(node,properties);return node;
}
function environment(){
 const listeners=new Map(),properties=new Map(),sources=[];let observer;
 const body=control({tagName:'BODY',textContent:''});
 const doc={body,activeElement:null,styleSheets:[{cssRules:[{selectorText:'#control-help',style:{setProperty:(key,value)=>properties.set(key,value)}}]}],
  querySelectorAll:()=>sources.filter(source=>source.isConnected),createElement:tag=>control({tagName:tag.toUpperCase(),textContent:'',getBoundingClientRect:()=>tag==='div'?{width:280,height:80}:{left:24,top:30,bottom:58,width:28,height:28}}),
  addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);}};
 const win={innerWidth:640,innerHeight:480,addEventListener(){},MutationObserver:class{constructor(fn){observer=fn;}observe(){}}};
 const installed=installContextHelp(doc,win);
 const e={doc,win,properties,installed,tip:installed.tip,
  add(source,parent=body){parent.appendChild(source);sources.push(source);source.focus=()=>{doc.activeElement=source;e.emit('focusin',{target:source});};installed.refresh();const icon=installed.infoFor(source);if(icon)icon.focus=()=>{doc.activeElement=icon;e.emit('focusin',{target:icon});};return source;},
  emit(type,event={}){event.preventDefault ||= ()=>{event.prevented=true;};event.stopPropagation ||= ()=>{event.stopped=true;};for(const fn of listeners.get(type)||[])fn(event);return event;},
  click(source){const target=installed.infoFor(source);assert.ok(target,'A source must have an info icon');return e.emit('click',{target});},mutate(){observer();}};return e;
}

test('context help distinguishes preparation, preview, recording and public transmission',()=>{
 setLanguage('en',{persist:false});assert.match(helpFor(control({dataset:{action:'go-live'}})),/Nothing is broadcast until you confirm/);assert.match(helpFor(control({dataset:{capture:'preview'}})),/never broadcasts/);assert.match(helpFor(control({dataset:{production:'record'}})),/does not start a public broadcast/);assert.match(helpFor(control({dataset:{capture:'start'},disabled:true})),/preview.*destination.*confirmation/);
 setLanguage('pt-PT',{persist:false});assert.match(helpFor(control({dataset:{production:'choose-recording-folder'}})),/não inicia a gravação/);setLanguage('en',{persist:false});
});
test('help never reads passwords or stream-key values',()=>{
 for(const name of ['password','key']){const field=control({tagName:'INPUT',name});Object.defineProperty(field,'value',{get(){throw Error('Secret value must not be read');}});assert.ok(helpFor(field));}
 const form={classList:{contains:cls=>cls==='chat-compose'}};assert.match(helpFor(control({type:'submit',form})),/Viewers.*can see/);
});
test('plain action buttons and the running queue add action always have information',()=>{
 assert.match(helpFor(control({id:'queue-add-button',textContent:'Add'})),/upcoming queue.*Save/);
 assert.match(helpFor(control({id:'pick-files',textContent:'Choose files'})),/system file picker.*Confirm/);
 assert.match(helpFor(control({textContent:'Choose files'})),/Choose files/);
 const e=environment(),button=e.add(control({textContent:'Choose files'}));assert.ok(e.installed.infoFor(button));
});
test('tooltip placement stays inside small viewports and flips above a low trigger',()=>{
 const p=tooltipPosition({left:350,top:650,bottom:694,width:35},{width:300,height:90},{width:390,height:720});assert.ok(p.left>=12&&p.left+300<=378);assert.ok(p.top+90<650);
});
test('hover and focus never open help; only adjacent info activation does',()=>{
 const e=environment(),button=e.add(control({dataset:{action:'go-live'}})),icon=e.installed.infoFor(button);
 for(const target of [button,icon]){e.emit('pointerover',{target,pointerType:'mouse'});e.emit('focusin',{target});assert.equal(e.tip.hidden,true);}
 const event=e.click(button);assert.ok(event.prevented&&event.stopped);assert.equal(e.tip.hidden,false);assert.equal(icon.getAttribute('aria-expanded'),'true');assert.match(e.tip.textContent,/Nothing is broadcast/);e.click(button);assert.equal(e.tip.hidden,true);assert.equal(icon.getAttribute('aria-expanded'),'false');
});
test('click help preserves accessibility metadata and permanently removes native hover titles',()=>{
 const e=environment(),button=control({dataset:{action:'go-live'}});button.setAttribute('title','Original title');button.setAttribute('aria-describedby','existing-note');e.add(button);
 assert.equal(button.hasAttribute('title'),false);e.click(button);assert.equal(button.getAttribute('aria-describedby'),'existing-note control-help');assert.ok(e.properties.has('left'));assert.equal(e.installed.isReading(),true);
 const event=e.emit('keydown',{key:'Escape'});assert.ok(event.prevented&&event.stopped);assert.equal(e.tip.hidden,true);assert.equal(button.hasAttribute('title'),false);assert.equal(button.getAttribute('aria-describedby'),'existing-note');assert.equal(e.installed.isReading(),false);assert.equal(installContextHelp(e.doc,e.win),e.installed);
});
test('Enter and Space activate only the info icon without submitting or toggling the source',()=>{
 const e=environment(),button=e.add(control({dataset:{action:'go-live'},type:'submit'})),icon=e.installed.infoFor(button);assert.equal(icon.tagName,'SPAN');assert.equal(icon.getAttribute('role'),'button');assert.equal(icon.tabIndex,0);
 const plain=e.emit('keydown',{target:button,key:'Enter'});assert.ok(!plain.prevented);assert.equal(e.tip.hidden,true);
 for(const key of ['Enter',' ']){const event=e.emit('keydown',{target:icon,key});assert.ok(event.prevented&&event.stopped);assert.equal(e.tip.hidden,false);e.emit('keydown',{target:icon,key,repeat:true});assert.equal(e.tip.hidden,false);e.emit('keyup',{target:icon,key});e.installed.hide();}
});
test('disabled actions keep clickable explanations; hidden actions hide their icons',()=>{
 const e=environment(),button=e.add(control({dataset:{capture:'start'},disabled:true})),icon=e.installed.infoFor(button);assert.ok(!icon.disabled);e.click(button);assert.match(e.tip.textContent,/free destination/);
 button.hidden=true;e.mutate();assert.equal(icon.hidden,true);assert.equal(button.parentNode.hidden,true);assert.equal(e.tip.hidden,true);button.hidden=false;e.mutate();assert.equal(icon.hidden,false);assert.equal(button.parentNode.hidden,false);
});
test('field icons preserve labels and prevent checkbox label activation',()=>{
 const e=environment(),label=control({tagName:'LABEL',textContent:'Include microphone'});e.doc.body.appendChild(label);
 const checkbox=e.add(control({tagName:'INPUT',type:'checkbox',name:'useMic',textContent:'',checked:false}),label),icon=e.installed.infoFor(checkbox);assert.equal(checkbox.getAttribute('aria-label'),'Include microphone');assert.equal(icon.parentNode,label);
 const event=e.click(checkbox);assert.ok(event.prevented&&event.stopped);assert.equal(checkbox.checked,false);e.installed.refresh();e.mutate();assert.equal(label.querySelectorAll('.control-info').length,1);
});
test('select and summary explanations preserve select contents and direct summary semantics',()=>{
 const e=environment(),select=e.add(control({tagName:'SELECT',name:'aspect'})),summary=e.add(control({tagName:'SUMMARY',textContent:'Options'}));assert.equal(e.installed.infoFor(select).parentNode,select.parentNode);assert.equal(select.children.length,0);assert.equal(e.installed.infoFor(summary).parentNode,summary);assert.ok(e.click(summary).prevented);assert.equal(e.tip.hidden,false);
});
test('dialog help uses its top layer and treats descriptions as text',()=>{
 const e=environment(),dialog=control({tagName:'DIALOG',open:true,textContent:''});e.doc.body.appendChild(dialog);const button=e.add(control({dataset:{help:'<img onerror=alert(1)> details'}}),dialog);e.click(button);assert.equal(e.tip.parentNode,dialog);assert.equal(e.tip.textContent,'<img onerror=alert(1)> details');assert.equal(e.tip.getAttribute('role'),'tooltip');
});
test('outside click dismisses without cancelling unrelated actions; scrolling help keeps it open',()=>{
 const e=environment(),button=e.add(control({dataset:{help:'Long explanation '.repeat(100)}}));e.click(button);e.emit('scroll',{target:e.tip});assert.equal(e.tip.hidden,false);const event=e.emit('click',{target:e.doc.body});assert.equal(e.tip.hidden,true);assert.ok(!event.prevented&&!event.stopped);
});
test('a delayed page scroll after clicking information repositions it without closing or resetting reading',()=>{
 const e=environment(),button=e.add(control({dataset:{help:'Long explanation '.repeat(100)}})),icon=e.installed.infoFor(button);let top=150;
 icon.getBoundingClientRect=()=>({left:24,top,bottom:top+28,width:28,height:28});e.click(button);const before=e.properties.get('top');e.tip.scrollTop=40;
 top=80;e.emit('scroll',{target:e.doc.body});assert.equal(e.tip.hidden,false);assert.notEqual(e.properties.get('top'),before);assert.equal(e.tip.scrollTop,40);assert.equal(icon.getAttribute('aria-expanded'),'true');assert.equal(e.installed.isReading(),true);
 e.emit('keydown',{key:'Escape'});assert.equal(e.tip.hidden,true);e.emit('scroll',{target:e.doc.body});assert.equal(e.tip.hidden,true,'Scrolling cannot reopen dismissed information');
});
test('dynamic controls get one icon and title-only controls retain accessible names',()=>{
 const e=environment(),button=control({textContent:''});button.setAttribute('title','Specific action');e.add(button);const icon=e.installed.infoFor(button);assert.equal(button.getAttribute('aria-label'),'Specific action');assert.equal(button.getAttribute('title'),null);assert.match(icon.getAttribute('aria-label'),/Specific action/);
 e.installed.refresh();e.mutate();assert.equal(e.installed.infoFor(button),icon);assert.equal(button.parentNode.querySelectorAll('.control-info').length,1);button.setAttribute('title','Updated explanation');e.mutate();assert.equal(button.getAttribute('title'),null);e.click(button);assert.equal(e.tip.textContent,'Updated explanation');
});
test('detaching cached panels removes decoration without deleting their reusable controls',()=>{
 const e=environment(),panel=control({tagName:'SECTION',textContent:''});e.doc.body.appendChild(panel);const button=e.add(control({dataset:{capture:'preview'}}),panel);e.click(button);panel.remove();e.mutate();assert.equal(e.tip.hidden,true);assert.equal(button.parentNode,panel);assert.equal(panel.children.length,1);assert.equal(e.installed.infoFor(button),undefined);e.doc.body.appendChild(panel);e.mutate();assert.ok(e.installed.infoFor(button));assert.ok(panel.contains(button));assert.equal(panel.querySelectorAll('.control-info').length,1);
});
test('changed prerequisites update open explanations within the available viewport',()=>{
 const e=environment();e.doc.documentElement={clientWidth:300};e.win.innerHeight=240;const button=e.add(control({dataset:{capture:'start'},disabled:false}));e.click(button);button.disabled=true;e.mutate();assert.match(e.tip.textContent,/free destination/);assert.equal(e.properties.get('max-width'),'276px');assert.equal(e.properties.get('max-height'),'216px');
});
test('restoring ordinary focus never opens help; info focus retains explicit reading only',()=>{
 const e=environment(),button=e.add(control({dataset:{action:'playlist-rename'}}));e.installed.restoreFocus(button,false);assert.equal(e.doc.activeElement,button);assert.equal(e.tip.hidden,true);e.installed.restoreFocus(button,true,false);assert.equal(e.tip.hidden,true);e.installed.restoreFocus(button,true,true);assert.equal(e.doc.activeElement,e.installed.infoFor(button));assert.equal(e.tip.hidden,false);e.installed.restoreFocus(button,false,true);assert.equal(e.tip.hidden,true);
});
test('dashboard entry points explain missing destinations',()=>{
 const h=uiHarness({locale:'en'});let html=h.run('dashboard()');assert.match(html,/Open live studio/);assert.match(html,/Prepared videos or playlists/);assert.match(html,/First time/);h.run("state.channels=[{id:'c',hasKey:false}]");assert.match(h.run('dashboard()'),/missing stream keys/);h.run("state.channels[0].hasKey=true");assert.match(h.run('dashboard()'),/destinations are configured/);
});
test('project export help distinguishes configuration from media and keys',()=>{const link=control({tagName:'A'});link.setAttribute('href','/api/export');assert.match(helpFor(link),/without stream keys.*Video files are not included/);});
