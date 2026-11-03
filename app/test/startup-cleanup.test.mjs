import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createApplication} from '../src/server.mjs';
import {CaptureFeeds} from '../src/capture-feeds.mjs';
import {Updates} from '../src/updates.mjs';

for(const phase of ['downloads','updates'])test('partial startup failure drains initialized services: '+phase,async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'startup-cleanup-'));
 const calls=[];let feeds;
 const feedShutdown=CaptureFeeds.prototype.shutdown;
 t.mock.method(CaptureFeeds.prototype,'shutdown',function(){feeds=this;calls.push('capture');return feedShutdown.call(this);});
 const updateShutdown=Updates.prototype.shutdown;
 t.mock.method(Updates.prototype,'shutdown',function(){calls.push('updates');return updateShutdown.call(this);});
 const options={directory,clock:true,listen:false,portableVault:true};
 if(phase==='downloads')options.downloadOptions={get spawnProcess(){throw Error('Injected startup failure');}};
 else t.mock.method(Updates.prototype,'startTimer',function(){throw Error('Injected startup failure');});
 t.after(async()=>{if(feeds)await feedShutdown.call(feeds);assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 await assert.rejects(createApplication(options),/Injected startup failure/);
 assert.equal(calls.filter(name=>name==='capture').length,1,'capture idle timer must be drained after startup rejects');
 if(phase==='updates')assert.ok(calls.includes('updates'),'initialized update service must also be drained');
});
