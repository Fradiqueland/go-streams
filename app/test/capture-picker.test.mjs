import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import picker from '../electron/capture-picker.cjs';
import {localized,setLanguage,languages,applyLocale} from '../public/i18n.js';
import {catalogs} from '../public/i18n-data.js';

test('native capture options, recording deletion and author credit follow every supported language',()=>{
 for(const [code]of languages){setLanguage(code,{persist:false});const labels=picker.pickerLabels(code);for(const value of Object.values(labels))assert.ok(typeof value==='string'&&value.length);if(!['en','pt-PT'].includes(code))assert.notEqual(labels.heading,picker.pickerLabels('en').heading);
  if(code!=='pt-PT')for(const key of ['Intro e encerramento automáticos','Apagar gravação','Criado por Antonio Fradique','Mais Produtos: AntonioFradique.net'])assert.ok(catalogs[code][key],code+': '+key);
  assert.equal(localized('Delete recording','Apagar gravação'),code==='pt-PT'?'Apagar gravação':catalogs[code]['Apagar gravação']);
 }
 setLanguage('en',{persist:false});
});
test('every automatic-video message has a translation in every selectable language',()=>{
 const source=fs.readFileSync(new URL('../public/production-bumpers.js',import.meta.url),'utf8');for(const [,en,pt]of source.matchAll(/\bt\('([^']*)','([^']*)'\)/g))for(const [code]of languages){if(code==='pt-PT')continue;assert.ok(catalogs[code][pt]!==undefined,code+': '+en);}
});
test('author text, accessible label and tooltip all use the selected language',()=>{
 const text={dataset:{i18n:'Criado por Antonio Fradique'}},label={dataset:{i18nLabel:'Mais Produtos: AntonioFradique.net'},setAttribute(key,value){this[key]=value;}},title={dataset:{i18nTitle:'Criado por Antonio Fradique · Mais Produtos: AntonioFradique.net'},setAttribute(key,value){this[key]=value;}};
 const doc={documentElement:{},querySelectorAll:selector=>selector==='[data-i18n]'?[text]:selector==='[data-i18n-label]'?[label]:selector==='[data-i18n-title]'?[title]:[],getElementById:()=>null};setLanguage('fr',{persist:false});applyLocale(doc);assert.match(text.textContent,/Créé/);assert.match(label['aria-label'],/Autres/);assert.match(title.title,/Créé/);setLanguage('en',{persist:false});
});
function fixture(){
 const ipcMain=new EventEmitter(),parent=new EventEmitter(),windows=[];parent.isDestroyed=()=>false;parent.webContents={session:{}};
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(channel,data)=>{this.data=data;};windows.push(this);}isDestroyed(){return Boolean(this.destroyed);}destroy(){this.destroyed=true;this.emit('closed');}loadFile(){return Promise.resolve();}show(){}setMenu(){}}
 const sources=[{id:'window:1',name:'<img onerror=bad>'},{id:'screen:1',name:'Desktop'}];return {ipcMain,parent,windows,sources,BrowserWindow:Window};
}
test('capture picker accepts an explicit current source only from its isolated child renderer',async()=>{
 const f=fixture(),selecting=picker.openCapturePicker({...f,locale:'pt-PT'}),child=f.windows[0];assert.equal(child.options.webPreferences.sandbox,true);assert.equal(child.options.webPreferences.nodeIntegration,false);assert.equal(child.options.webPreferences.contextIsolation,true);
 f.ipcMain.emit('streamland-picker-ready',{sender:child.webContents});assert.equal(child.data.labels.share,'Partilhar origem selecionada');assert.equal(child.data.sources[1].number,1);
 f.ipcMain.emit('streamland-picker-select',{sender:f.parent.webContents},'screen:1');f.ipcMain.emit('streamland-picker-select',{sender:child.webContents},'screen:unknown');assert.equal(child.isDestroyed(),false);
 f.ipcMain.emit('streamland-picker-select',{sender:child.webContents},'screen:1');assert.equal(await selecting,f.sources[1]);assert.equal(f.ipcMain.listenerCount('streamland-picker-select'),0);
});
test('closing a picker or its parent cancels capture, clears IPC and permits a fresh request',async()=>{
 for(const target of ['child','parent']){const f=fixture(),pending=picker.openCapturePicker(f);assert.equal(await picker.openCapturePicker(f),null);if(target==='child')f.windows[0].destroy();else f.parent.emit('closed');assert.equal(await pending,null);assert.equal(f.ipcMain.listenerCount('streamland-picker-ready'),0);const again=picker.openCapturePicker(f);f.windows.at(-1).destroy();assert.equal(await again,null);}
});
