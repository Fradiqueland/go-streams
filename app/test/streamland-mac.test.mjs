import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {requireMacLauncher} from '../scripts/build-mac-launcher.mjs';
import {universalFixture} from './macho-fixture.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('Streamland Mac build refuses the previous launcher and detects source changes before packaging',t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'streamland-mac-test-'));
 t.after(()=>{if(!root.startsWith(parent+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
 const directory=path.join(root,'vendor','mac-launcher');fs.mkdirSync(directory,{recursive:true});
 const source=path.join(root,'scripts','mac-launcher','main.go');fs.mkdirSync(path.dirname(source),{recursive:true});
 fs.writeFileSync(source,'package main // Streamland launcher fixture\n');
 const bytes=universalFixture();
 fs.writeFileSync(path.join(directory,'GoStreams'),bytes);
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({bytes:bytes.length,sha256:hash(bytes),sourceSha256:hash(fs.readFileSync(source))}));
 assert.throws(()=>requireMacLauncher(root),/Streamland Mac launcher is missing.*build-mac-launcher/);
 const launcher=path.join(directory,'Streamland');fs.writeFileSync(launcher,bytes);
 assert.equal(requireMacLauncher(root),launcher);
 fs.appendFileSync(source,'// changed without recompiling\n');
 assert.throws(()=>requireMacLauncher(root),/source changed.*Rebuild/);
});
