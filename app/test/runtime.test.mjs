import {toolsFor} from '../src/core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {mediaToolPath} from '../src/tool-paths.mjs';
import {requireRuntime,copyRuntime} from '../scripts/vendor-runtime.mjs';
import {runtimeFixture} from './runtime-fixture.mjs';
function fixture(t){const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'runtime-'));t.after(()=>{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('runtime-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});runtimeFixture(root);return root;}
test('packaged media tools resolve inside the moved app with independent explicit overrides',t=>{
 const root=fixture(t),destination=path.join(root,'Moved application');copyRuntime(root,destination,'win32');
 for(const name of ['ffmpeg','ffprobe'])assert.equal(mediaToolPath(name,{},{root:destination,platform:'win32',arch:'x64'}),path.join(destination,'runtime','win32-x64',name+'.exe'));
 assert.equal(mediaToolPath('ffmpeg',{ffmpeg:'C:/custom/ffmpeg.exe'},{root:destination}),'C:/custom/ffmpeg.exe');
 fs.unlinkSync(path.join(destination,'runtime','win32-x64','ffprobe.exe'));
 assert.throws(()=>mediaToolPath('ffprobe',{},{root:destination,platform:'win32'}),/missing/);
 assert.equal(mediaToolPath('ffmpeg',{},{root}),'ffmpeg');
});
test('Mac bundle carries both native architectures and rejects incomplete or corrupt runtime inputs',t=>{
 const root=fixture(t),out=path.join(root,'Mac');copyRuntime(root,out,'darwin');
 for(const arch of ['x64','arm64'])for(const name of ['ffmpeg','ffprobe'])assert.equal(mediaToolPath(name,{},{root:out,platform:'darwin',arch}),path.join(out,'runtime','darwin-'+arch,name));
 assert.equal(fs.existsSync(path.join(out,'runtime','win32-x64')),false);
 const file=path.join(root,'vendor','runtime','darwin-arm64','node');fs.writeFileSync(file,'damaged');assert.throws(()=>requireRuntime(root,'darwin-arm64'),/Invalid/);
 const rejected=path.join(root,'Rejected');assert.throws(()=>copyRuntime(root,rejected,'darwin'));assert.equal(fs.existsSync(rejected),false);
});

test('a missing bundled downloader does not select PATH tools or disable the separate media engines',t=>{
 const root=fixture(t),out=path.join(root,'Partial package');copyRuntime(root,out,'win32');
 const tools=toolsFor({},{root:out,platform:'win32',arch:'x64'});
 assert.equal(tools.ffmpeg,path.join(out,'runtime','win32-x64','ffmpeg.exe'));
 assert.throws(()=>tools.ytdlp,/Bundled yt-dlp is missing/);
 assert.equal(tools.ffprobe,path.join(out,'runtime','win32-x64','ffprobe.exe'));
 assert.equal(toolsFor({ytdlp:'C:/custom/yt-dlp.exe'},{root:out,platform:'win32'}).ytdlp,'C:/custom/yt-dlp.exe');
});
