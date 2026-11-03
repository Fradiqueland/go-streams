import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLocale,languages,savedLanguage,setLanguage} from '../public/i18n.js';
import {ProductionTools} from '../public/live-production.js';
import {uiHarness} from './ui-harness.mjs';

test('Streamland keeps the language, library view and saved scene from an existing installation',()=>{
 const saved=new Map([
  ['go-streams-language','fr'],
  ['media-layout','grid'],
  ['go-streams-scenes',JSON.stringify({main:{layout:'split',name:'Saved presenter',ticker:'Saved programme',micVolume:0.75}})]
 ]);
 const storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
 const before=[...saved];
 const locale=savedLanguage(storage),h=uiHarness({locale,storage});
 assert.equal(locale,'fr');assert.equal(h.run('mediaLayout'),'grid');
 h.run("health={version:'1.2.0',tools:{}};page='settings';draw()");
 assert.match(h.element('#content').innerHTML,/Streamland 1\.2\.0/);
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  const production=new ProductionTools({});
  assert.equal(production.scenes.main.layout,'split');
  assert.equal(production.scenes.main.name,'Saved presenter');
  assert.equal(production.scenes.main.ticker,'Saved programme');
  assert.equal(production.scenes.main.micVolume,0.75);
 }finally{
  if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;
 }
 assert.deepEqual([...saved],before);
});

test('every supported language uses Streamland in the document title and update panel',()=>{
 for(const [locale] of languages){
  setLanguage(locale,{persist:false});
  const doc={documentElement:{},querySelectorAll:()=>[],getElementById:()=>null};
  applyLocale(doc);assert.match(doc.title,/^Streamland /);
  const h=uiHarness({locale});h.run("page='settings';draw()");
  assert.match(h.element('#content').innerHTML,/Streamland/);
  assert.doesNotMatch(h.element('#content').innerHTML,/Go Streams/);
 }
});
