import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ytdlpPath} from '../src/tool-paths.mjs';
import {copyYtdlp,requireYtdlp,verifyVendorFile,downloadVendorFile,prepareYtdlp} from '../scripts/vendor-ytdlp.mjs';
import {vendorFixture} from './vendor-fixture.mjs';
function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'vendor-ytdlp-'));
 t.after(()=>{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('vendor-ytdlp-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
 return {root,...vendorFixture(root)};
}
test('portable yt-dlp resolution follows the app location, keeps explicit overrides and falls back for source-only installs',t=>{
 const {root}=fixture(t);
 for(const platform of ['win32','darwin']){
  const file=path.join(root,'vendor','yt-dlp',platform,platform==='win32'?'yt-dlp.exe':'yt-dlp');
  assert.equal(ytdlpPath({},{root,platform}),file);
  assert.equal(ytdlpPath({ytdlp:'/custom/yt-dlp'},{root,platform}),'/custom/yt-dlp');
  fs.unlinkSync(file);assert.equal(ytdlpPath({},{root,platform}),'yt-dlp');
 }
 assert.equal(ytdlpPath({},{root,platform:'linux'}),'yt-dlp');
});
test('portable build includes only its platform binary, licenses and source; damaged inputs fail before copying',t=>{
 const {root,directory}=fixture(t),destination=path.join(root,'relocated application');
 copyYtdlp(root,destination,'win32');
 assert.equal(ytdlpPath({},{root:destination,platform:'win32'}),path.join(destination,'vendor','yt-dlp','win32','yt-dlp.exe'));
 assert.equal(fs.existsSync(path.join(destination,'vendor','yt-dlp','darwin','yt-dlp')),false);
 for(const name of ['LICENSE','THIRD_PARTY_LICENSES.txt','source/yt-dlp.tar.gz'])assert.ok(fs.existsSync(path.join(destination,'vendor','yt-dlp',name)));
 fs.writeFileSync(path.join(directory,'win32','yt-dlp.exe'),'damaged');
 const rejected=path.join(root,'rejected');assert.throws(()=>copyYtdlp(root,rejected,'win32'),/missing or invalid/);assert.equal(fs.existsSync(rejected),false);
});
test('dependency download verifies bytes before replacement and cleans failed staged files',async t=>{
 const {root,files}=fixture(t),entry=files[0],destination=path.join(root,'downloaded.exe'),bytes=Buffer.from('Fixture only: '+entry.path);
 fs.writeFileSync(destination,'previous verified version');
 for(const body of [Buffer.alloc(entry.bytes,65),bytes.subarray(1),Buffer.concat([bytes,Buffer.from('extra')])]){
  await assert.rejects(downloadVendorFile(entry,destination,{fetcher:async()=>new Response(body)}),/integrity|exceeds/);
  assert.equal(fs.readFileSync(destination,'utf8'),'previous verified version');
  assert.equal(fs.readdirSync(root).filter(name=>name.endsWith('.part')).length,0);
 }
 await downloadVendorFile(entry,destination,{fetcher:async()=>new Response(bytes)});
 assert.equal(verifyVendorFile(destination,entry),true);
});
test('dependency download restricts redirect origins and reuses already verified files offline',async t=>{
 const {root,files}=fixture(t);let calls=0;
 await assert.rejects(downloadVendorFile(files[0],path.join(root,'redirect.exe'),{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://unsafe.test/tool.exe'}});}}),/Untrusted/);
 assert.equal(calls,1);
 await prepareYtdlp(root,{fetcher:async()=>assert.fail('Verified files must not be downloaded again')});
 requireYtdlp(root,'win32');requireYtdlp(root,'darwin');
});
test('license files are checked against the pinned upstream Git blob',t=>{
 const {root}=fixture(t),bytes=Buffer.from('License with UTF-8: ação\n'),file=path.join(root,'license.txt');fs.writeFileSync(file,bytes);
 const entry={bytes:bytes.length,gitSha1:crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')};
 assert.equal(verifyVendorFile(file,entry),true);fs.writeFileSync(file,Buffer.alloc(bytes.length));assert.equal(verifyVendorFile(file,entry),false);
});
