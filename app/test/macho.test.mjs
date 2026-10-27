import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {inspectMachO,macRequirements} from '../scripts/macho.mjs';
import {machoFixture,universalFixture} from './macho-fixture.mjs';

test('Mac deployment target and architectures are read from binaries, including universal yt-dlp',()=>{
 assert.deepEqual(inspectMachO(universalFixture()).map(s=>s.arch),['x64','arm64']);
 const [node]=inspectMachO(machoFixture('arm64',0x0d0500));assert.equal(node.minimum,0x0d0500);assert.deepEqual(node.libraries,['/usr/lib/libSystem.B.dylib']);
 for(const bytes of [Buffer.alloc(8),universalFixture().subarray(0,40),machoFixture('x64').subarray(0,60)])assert.throws(()=>inspectMachO(bytes));
 const invalid=machoFixture('x64');invalid.writeUInt32LE(0xffffffff,36);assert.throws(()=>inspectMachO(invalid),/size/);
});
test('Mac packaging rejects wrong CPU and external Homebrew libraries before creating a misleading portable app',t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'macho-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'node');
 fs.writeFileSync(file,machoFixture('x64'));assert.equal(macRequirements([{file,arches:['x64']}]),'13.5.0');assert.throws(()=>macRequirements([{file,arches:['arm64']}]),/Missing arm64/);
 fs.writeFileSync(file,machoFixture('x64',0x0d0500,'/opt/homebrew/lib/libfake.dylib'));assert.throws(()=>macRequirements([{file,arches:['x64']}]),/External Mac library/);
});
