import * as overlays from '../public/overlays-ui.js';
import * as i18n from '../public/i18n.js';
import fs from 'node:fs';
import vm from 'node:vm';
import * as ui from '../public/studio-ui.js';
import * as extras from '../public/extras.js';
import * as zones from '../public/timezones.js';
// Runs production event callbacks against controlled DOM entry points. No browser/layout claims.
export function uiHarness({fetch=async()=>({ok:true,json:async()=>({})}),confirm=true,locale='pt-PT',storage={getItem:()=>null,setItem(){}}}={}){
 i18n.setLanguage(locale,{persist:false});
 const elements=new Map(),listeners=new Map(),buttons=[],intervals=[],requests=[];
 function element(key){
  if(elements.has(key))return elements.get(key);
  const handlers=new Map(), el={key,id:key.startsWith('#')?key.slice(1):'',tagName:'DIV',dataset:{},value:'',textContent:'',hidden:false,disabled:false,checked:false,open:false,options:[],selectedOptions:[],elements:[],innerHTML:'',
   querySelector(q){return element(this.key+' '+q);},querySelectorAll(){return[];},closest(q){return q==='form'?this.form:q==='details'?element('details'):(q==='[data-action]'&&this.dataset.action)||(q==='[data-secret]'&&this.dataset.secret)?this:null;},
   addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},
   setAttribute(name,value){this[name]=value;},showModal(){this.open=true;},close(){this.open=false;for(const fn of handlers.get('close')||[])fn();},focus(){},setSelectionRange(){}};
  el.elements.namedItem=name=>el.elements.find(e=>e.name===name);
  if(key==='#dialog-content'){
   let html='';Object.defineProperty(el,'innerHTML',{get:()=>html,set:value=>{html=value;if(value){elements.delete('#modal-form');element('#modal-form');}}});
  }
  elements.set(key,el);return el;
 }
 const document={querySelector:element,querySelectorAll:selector=>selector==='[data-action]'?buttons:[],getElementById:id=>element('#'+id),addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);},activeElement:null};
 class FormData{
  constructor(form){this.entries=form.elements.filter(e=>e.name&&!e.disabled&&(e.type!=='checkbox'||e.checked)).map(e=>[e.name,e.value]);}
  get(name){return this.entries.find(e=>e[0]===name)?.[1]??null;}getAll(name){return this.entries.filter(e=>e[0]===name).map(e=>e[1]);}has(name){return this.entries.some(e=>e[0]===name);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}
 }
 const context=vm.createContext({...overlays,...i18n,...ui,...extras,...zones,document,location:{hash:''},localStorage:storage,Intl,Date,structuredClone,URL,console,FormData,setTimeout:()=>1,clearTimeout(){},setInterval:fn=>intervals.push(fn),clearInterval(){},window:{addEventListener(){}},confirm:typeof confirm==='function'?confirm:()=>confirm,fetch:async(url,init)=>{requests.push({url,...init});return fetch(url,init);}});
 let source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
 const start=source.indexOf('try { await refresh(); health =');const end=source.indexOf('const poll =',start);if(start<0||end<0)throw Error('Startup marker changed');source=source.slice(0,start)+source.slice(end);
 vm.runInContext(source,context);
 function fields(id,values){const form=element('#'+id);form.elements=Object.entries(values).flatMap(([name,value])=>(Array.isArray(value)?value:[value]).map(v=>({name,dataset:{},value:typeof v==='boolean'?'on':v,checked:typeof v==='boolean'?v:false,type:typeof v==='boolean'?'checkbox':'text',disabled:false,form,closest:q=>q==='form'?form:null})));form.elements.namedItem=name=>form.elements.find(e=>e.name===name);return form;}
 async function emit(type,target){for(const fn of listeners.get(type)||[])await fn({target,preventDefault(){}});}
 async function click(action,id){const b=element('button-'+buttons.length);b.dataset={action,id};buttons.push(b);await emit('click',b);return b;}
 async function submit(values,id='modal-form'){const form=fields(id,values);if(id==='modal-form')await form.onsubmit({target:form,preventDefault(){}});else await emit('submit',form);return form;}
 return {context,element,fields,emit,click,submit,requests,intervals,buttons,run:code=>vm.runInContext(code,context)};
}
