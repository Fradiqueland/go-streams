import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tr,setLanguage,savedLanguage,language,localeTag,applyLocale,languages} from '../public/i18n.js';
import {catalogs} from '../public/i18n-data.js';
import {uiHarness} from './ui-harness.mjs';
test('English is the default; supported choices persist and invalid saved values fall back',()=>{
 assert.equal(savedLanguage(undefined),'en');assert.equal(savedLanguage({getItem:()=> 'invalid'}),'en');assert.equal(savedLanguage({getItem(){throw Error();}}),'en');
 const store=new Map(),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
 setLanguage('fr',{storage});assert.equal(savedLanguage(storage),'fr');assert.equal(tr('Definições'),'Paramètres');assert.throws(()=>setLanguage('xx',{storage}));assert.equal(language(),'fr');
 assert.throws(()=>setLanguage('ar',{storage:{setItem(){throw Error();}}}));assert.equal(language(),'fr');
});
test('all nine requested languages and Portuguese have navigation and safe English fallbacks',()=>{
 assert.equal(languages.length,10);
 for(const [code] of languages){setLanguage(code,{persist:false});assert.ok(tr('Visão geral'));assert.ok(tr('Guardar'));assert.equal(tr('Ação sem entrada'), 'Ação sem entrada');if(code!=='pt-PT')assert.equal(tr('A sua programação, os seus canais e cada direto num só lugar.'),'Your programmes, channels and live streams in one place.');}
 for(const [code,entries]of Object.entries(catalogs))for(const[key,value]of Object.entries(entries)){assert.equal(typeof value,'string',code+key);assert.ok(!/[<>]/.test(value),code+key);assert.ok(catalogs.en[key]!==undefined,code+key);}
});
test('Arabic switches document direction; date locale follows the selection',()=>{
 const doc={documentElement:{},querySelectorAll:()=>[],getElementById:()=>null};setLanguage('ar',{persist:false});applyLocale(doc);assert.equal(doc.documentElement.dir,'rtl');assert.equal(doc.documentElement.lang,'ar');
 setLanguage('en',{persist:false});applyLocale(doc);assert.equal(doc.documentElement.dir,'ltr');assert.equal(localeTag(),'en-GB');
});
test('rendering all pages in every language preserves user data and functional identifiers',()=>{
 for(const[code]of languages){const h=uiHarness({locale:code});h.run("state.media=[{id:'m',title:'Definições',duration:2,size:10,width:640,height:360,fps:30,codec:'h264'}];state.channels=[{id:'c',name:'Visão geral',platform:'YouTube',url:'rtmp://example.test/live'}];state.playlists=[{id:'p',name:'Guardar',quality:'720p',mediaIds:['m']}]");
 for(const page of ['dashboard','golive','live','media','channels','playlists','schedules','tools','history','settings','help']){h.run('page='+JSON.stringify(page)+';draw()');assert.ok(h.element('#content').innerHTML.includes('<h1>'));}
 h.run("page='media';draw()");assert.ok(h.element('#content').innerHTML.includes('Definições'));assert.ok(h.element('#content').innerHTML.includes('data-action="single-live"'));if(code==='en')assert.ok(h.element('#nav').innerHTML.includes('Settings'));
 }
});
test('language switch protects open editors and unsaved settings',async()=>{
 const h=uiHarness({locale:'en'}),select=h.element('#language-select');h.context.location.reload=()=>{h.context.reloaded=true;};select.value='ar';h.element('#dialog').open=true;select.onchange({target:select});assert.equal(h.context.reloaded,undefined);assert.equal(select.value,'en');
 h.element('#dialog').open=false;select.value='ar';select.onchange({target:select});assert.equal(h.context.reloaded,true);
 const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(index.includes('Criado por Antonio Fradique'));assert.ok(index.includes('Mais Produtos: AntonioFradique.net'));assert.match(index,/href="https:\/\/AntonioFradique.net" target="_blank" rel="noopener noreferrer"/);
});
