import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const file=path.join(root,'release','GoStreams-'+version+'-SingleFile.exe');
const parent=path.join(root,'.tmp');fs.mkdirSync(parent,{recursive:true});
const temp=fs.mkdtempSync(path.join(parent,'single-file-smoke-'));
const cache=path.join(temp,'cache'),data=path.join(temp,'data');
const env={...process.env,PATH:'',GO_STREAMS_CACHE:cache,GO_STREAMS_DATA:data};
try{
 function verify(){
  const result=spawnSync(file,['--verify'],{cwd:temp,env,windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
  if(result.status!==0)throw Error(result.error?.message||result.stderr||'Single-file verification failed: '+result.status);
  const parsed=JSON.parse(result.stdout.trim());
  assert.equal(parsed.version,version);assert.ok(parsed.cache.startsWith(cache+path.sep));return parsed;
 }
 const cold=verify();assert.equal(cold.reused,false);
 const runtime=path.join(cold.cache,'runtime','win32-x64','node.exe');
 const modified=fs.statSync(runtime).mtimeMs;
 const warm=verify();assert.equal(warm.reused,true);assert.equal(warm.cache,cold.cache);
 assert.equal(fs.statSync(runtime).mtimeMs,modified);
 for(const name of ['icon.ico','icon.webp','icon.png','icon.icns'])assert.deepEqual(fs.readFileSync(path.join(cold.cache,'public',name)),fs.readFileSync(path.join(root,'public',name)));
 const check=spawnSync(process.execPath,[path.join(root,'scripts','check-portable.mjs'),'--application-root='+cold.cache],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024});
 if(check.status!==0)throw Error(check.error?.message||check.stdout||check.stderr||'Extracted application smoke test failed');
 const smoke=JSON.parse(check.stdout.trim().split(/\r?\n/).at(-1));
 assert.equal(smoke.PATH,'');assert.equal(smoke.backupRoundTrip,true);
 const report={version,file,bytes:fs.statSync(file).size,files:cold.files,coldVerificationMs:cold.milliseconds,warmVerificationMs:warm.milliseconds,warmCacheReused:true,iconMatchesChosenImage:true,portableSmoke:smoke,desktopWindowTested:false};
 fs.writeFileSync(path.join(root,'release','GoStreams-v'+version+'-SingleFile-verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{
 assert.ok(temp.startsWith(parent+path.sep));assert.ok(path.basename(temp).startsWith('single-file-smoke-'));
 fs.rmSync(temp,{recursive:true,force:true});
}
