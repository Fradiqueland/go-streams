import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Store,Studio,Vault} from '../src/core.mjs';

test('project import rejects inherited property names as IDs before changing data',async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'identifier-safety-'));
 const store=new Store(directory),studio=new Studio(store,new Vault(directory,{portable:true}));
 t.after(async()=>{await studio.shutdown();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const before=JSON.stringify(store.data);
 for(const id of ['__proto__','constructor','toString']){
  await assert.rejects(studio.importProject({version:1,media:[],channels:[{id,name:'Imported',platform:'YouTube',url:'rtmp://localhost/live'}],playlists:[],schedules:[],channelPlans:{}}),/Identificadores/);
  assert.equal(JSON.stringify(store.data),before);
 }
});
