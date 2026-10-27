import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {requireMacLauncher} from '../scripts/build-mac-launcher.mjs';
import {machoFixture,universalFixture} from './macho-fixture.mjs';

test('Mac packaging requires the exact universal native launcher and detects corruption',t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'mac-launcher-test-'));
 t.after(()=>{if(!root.startsWith(parent+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
 const directory=path.join(root,'vendor','mac-launcher');fs.mkdirSync(directory,{recursive:true});
 const write=bytes=>{fs.writeFileSync(path.join(directory,'GoStreams'),bytes);fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));};
 write(universalFixture());assert.equal(requireMacLauncher(root),path.join(directory,'GoStreams'));
 fs.writeFileSync(path.join(directory,'GoStreams'),'corrupt');assert.throws(()=>requireMacLauncher(root),/integrity/);
 write(machoFixture('x64'));assert.throws(()=>requireMacLauncher(root),/Intel and Apple Silicon/);
});
