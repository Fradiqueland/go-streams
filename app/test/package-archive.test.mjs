import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const python=process.env.PYTHON||'python';
const available=spawnSync(python,['--version'],{encoding:'utf8',windowsHide:true}).status===0;
function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'package-archive-'));
 t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const put=(name,contents)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);};
 for(const name of ['package.json','README.md','STREAMYARD-FEATURE-SCOPE.md','.gitignore'])put(name,name==='package.json'?JSON.stringify({version:'1.2.3'}):'fixture');
 for(const name of ['src/server.mjs','public/index.html','test/electron.test.mjs','electron/window-policy.cjs','electron/capture-policy.cjs','electron/data-policy.cjs','electron/main.cjs','electron/toolchain.json'])put(name,'fixture');
 put('scripts/package.py',fs.readFileSync(new URL('../scripts/package.py',import.meta.url)));
 for(const name of ['vendor/yt-dlp/manifest.json','vendor/runtime/downloads.json'])put(name,'{}');
 const release='release/GoStreams-1.2.3';
 for(const name of ['package.json','README.md','STREAMYARD-FEATURE-SCOPE.md','src/server.mjs','public/index.html'])put(release+'/'+name,fs.readFileSync(path.join(root,name)));
 for(const name of ['GoStreams.exe','CloseGoStreams.cmd','vendor/yt-dlp/win32/yt-dlp.exe'])put(release+'/'+name,'fixture');
 const files=['node.exe','ffmpeg.exe','ffprobe.exe'].map(name=>({name,bytes:7,sha256:crypto.createHash('sha256').update('fixture').digest('hex')}));
 for(const entry of files)put(release+'/runtime/win32-x64/'+entry.name,'fixture');
 put(release+'/runtime/win32-x64/manifest.json',JSON.stringify({files}));
 const destination=path.join(root,'output');fs.mkdirSync(destination);
 return {root,destination,put,run:(platform='win32')=>spawnSync(python,[path.join(root,'scripts/package.py'),destination,platform],{encoding:'utf8',windowsHide:true,timeout:20000})};
}

test('source ZIP includes Electron policies and source/portable archives retain the build guide',{skip:!available},t=>{
 const f=fixture(t),result=f.run();assert.equal(result.status,0,result.stdout+result.stderr);
 const checked=spawnSync(python,['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); required=["source/electron/"+n for n in ["main.cjs","window-policy.cjs","capture-policy.cjs","data-policy.cjs","toolchain.json"]]+["source/STREAMYARD-FEATURE-SCOPE.md","GoStreams/STREAMYARD-FEATURE-SCOPE.md"]; assert all(n in z.namelist() for n in required),z.namelist()',path.join(f.destination,'GoStreams-v1.2.3-Windows.zip')],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(checked.status,0,checked.stdout+checked.stderr);
});

for(const phase of ['copy','verification'])test('failed '+phase+' preserves an existing release ZIP and removes the candidate',{skip:!available},t=>{
 const f=fixture(t),output=path.join(f.destination,'GoStreams-v1.2.3-Windows.zip'),prior=Buffer.from('previous verified release');fs.writeFileSync(output,prior);
 if(phase==='copy')fs.unlinkSync(path.join(f.root,'README.md'));
 else f.put('release/GoStreams-1.2.3/public/index.html','stale application');
 const result=f.run();assert.notEqual(result.status,0);assert.ok(fs.readFileSync(output).equals(prior),'Previous release ZIP was changed');
 assert.deepEqual(fs.readdirSync(f.destination),[path.basename(output)]);
});
