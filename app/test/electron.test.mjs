import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import dataPolicy from '../electron/data-policy.cjs';
import policy from '../electron/window-policy.cjs';

function fixture(t){const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'electron-policy-'));t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});return root;}
function write(root,name,value){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}

test('Electron data and persistent session paths do not include an application version',()=>{
 const paths=dataPolicy.userPaths('C:/Users/Antonio/AppData/Local');
 assert.equal(paths.data,path.resolve('C:/Users/Antonio/AppData/Local','Go Streams','data'));
 assert.equal(dataPolicy.userPaths('C:/Users/Antonio/AppData/Local','D:/ExistingData').data,path.resolve('D:/ExistingData'));
});
test('Electron preserves portable projects and credentials, and never merges over existing installed data',t=>{
 const root=fixture(t),source=path.join(root,'portable','GoStreams-data'),target=path.join(root,'local','Go Streams','data');
 for(const [name,value]of Object.entries({'project.json':'original project','vault.dpapi':'protected key','desktop-browser/Default/Network/Cookies':'old browser sessions','session.url':'transient token'}))write(source,name,value);
 assert.equal(dataPolicy.discoverLegacy(path.dirname(source)),source);
 assert.equal(dataPolicy.migrateData(target,source).migrated,true);
 assert.equal(fs.readFileSync(path.join(target,'project.json'),'utf8'),'original project');
 assert.equal(fs.readFileSync(path.join(target,'vault.dpapi'),'utf8'),'protected key');
 assert.ok(!fs.existsSync(path.join(target,'session.url')));
 write(source,'project.json','different portable project');
 for(let update=0;update<3;update++)assert.equal(dataPolicy.migrateData(target,source).migrated,false);
 assert.equal(fs.readFileSync(path.join(target,'project.json'),'utf8'),'original project');
 assert.equal(fs.readFileSync(path.join(source,'desktop-browser/Default/Network/Cookies'),'utf8'),'old browser sessions');
});
test('Electron migrates local UI preferences once and preserves the old browser cookies',t=>{
 const root=fixture(t);write(root,'desktop-browser/Default/Local Storage/leveldb/000001.log','existing preferences');write(root,'desktop-browser/Default/Network/Cookies','Edge cookies remain in Edge');
 const session=dataPolicy.migratePreferences(root);
 assert.equal(fs.readFileSync(path.join(session,'Local Storage/leveldb/000001.log'),'utf8'),'existing preferences');
 assert.ok(!fs.existsSync(path.join(session,'Network/Cookies')));
 write(session,'Local Storage/leveldb/000001.log','Electron preferences after use');
 dataPolicy.migratePreferences(root);
 assert.equal(fs.readFileSync(path.join(session,'Local Storage/leveldb/000001.log'),'utf8'),'Electron preferences after use');
 assert.equal(fs.readFileSync(path.join(root,'desktop-browser/Default/Network/Cookies'),'utf8'),'Edge cookies remain in Edge');
});
test('interrupted Electron data migration does not publish a partial profile or modify its source',t=>{
 const root=fixture(t),source=path.join(root,'old'),target=path.join(root,'new','data');write(source,'project.json','preserved');
 t.mock.method(fs,'copyFileSync',()=>{throw Error('Controlled copy failure');});
 assert.throws(()=>dataPolicy.migrateData(target,source),/Controlled/);
 assert.ok(!fs.existsSync(target));assert.equal(fs.readFileSync(path.join(source,'project.json'),'utf8'),'preserved');
 assert.deepEqual(fs.readdirSync(path.dirname(target)),[]);
});
test('nested data migration and ambiguous portable projects are rejected',t=>{
 const root=fixture(t),source=path.join(root,'old');write(source,'project.json','project');
 assert.throws(()=>dataPolicy.migrateData(path.join(source,'nested','data'),source),/separate/);
 write(root,'GoStreams-0.15.0/data/project.json','one');write(root,'GoStreams-0.15.5/data/project.json','two');
 assert.throws(()=>dataPolicy.discoverLegacy(root),/More than one/);
});
test('Electron isolates its renderer and sends only HTTPS links to the system browser',async()=>{
 const contents=new EventEmitter(),opened=[];contents.setWindowOpenHandler=handler=>contents.popup=handler;
 policy.wireNavigation(contents,{base:'http://127.0.0.1:4317',openExternal:url=>opened.push(url)});
 for(const url of ['file:///C:/Windows/cmd.exe','javascript:alert(1)','data:text/html,bad','http://example.com','https://user:password@example.com'])assert.equal(contents.popup({url}).action,'deny');
 assert.deepEqual(opened,[]);
 assert.equal(contents.popup({url:'https://antoniofradique.net/Spotify'}).action,'deny');assert.deepEqual(opened,['https://antoniofradique.net/Spotify']);
 let prevented=0;contents.emit('will-navigate',{preventDefault(){prevented++;}},'file:///C:/test');contents.emit('will-navigate',{preventDefault(){prevented++;}},'http://127.0.0.1:4317/#settings');
 assert.equal(prevented,1);
 const preferences=policy.rendererPreferences({});for(const key of ['nodeIntegration','nodeIntegrationInWorker','nodeIntegrationInSubFrames','webviewTag','allowRunningInsecureContent'])assert.equal(preferences[key],false);
 for(const key of ['sandbox','contextIsolation','webSecurity'])assert.equal(preferences[key],true);
});
function backend(){return {studio:{jobs:new Map(),pendingImports:new Set(),pendingPreparations:new Set(),pendingOperations:new Set()},downloads:{active:new Map()},async close(){}};}
test('closing Electron during a stream requires confirmation and preserves the running application when declined',async()=>{
 const b=backend();b.studio.jobs.set('live',{ended:false});let closed=0,finished=0;b.close=async()=>closed++;
 const quit=policy.shutdownCoordinator({backend:b,confirm:async()=>false,finish:async()=>finished++});
 assert.equal(await quit(),false);assert.equal(closed,0);assert.equal(finished,0);
});
test('repeated Electron close requests share one confirmation and drain the backend once',async()=>{
 const b=backend();b.downloads.active.set('download',{});let release,asked=0,closed=0,finished=0;
 b.close=async()=>closed++;
 const quit=policy.shutdownCoordinator({backend:b,confirm:()=>{asked++;return new Promise(resolve=>release=resolve);},finish:async()=>finished++});
 const a=quit(),c=quit();release(true);assert.equal(await a,true);assert.equal(await c,true);
 assert.equal(asked,1);assert.equal(closed,1);assert.equal(finished,1);await quit();assert.equal(closed,1);
});
