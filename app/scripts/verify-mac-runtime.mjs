// Native runtime smoke test; UI translation prompts and window focus still
// require visual acceptance on a Mac desktop.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

if(process.platform!=='darwin')throw Error('Run native Mac verification on macOS.');
const bundle=path.resolve(process.argv[2]);
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
const data=fs.mkdtempSync(path.join(parent,'mac-runtime-'));
const version=JSON.parse(fs.readFileSync(path.join(bundle,'Contents/Resources/app/package.json'),'utf8')).version;
const server=net.createServer();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const child=spawn(path.join(bundle,'Contents/MacOS/GoStreams'),[],{env:{...process.env,GO_STREAMS_DATA:data,GO_STREAMS_PORT:String(port)},stdio:'ignore'});
let launchError;child.once('error',error=>{launchError=error;});
let base,cookie;
const report={version,platform:process.platform,architecture:process.arch,passed:false,visualTranslationPromptVerified:false,windowForegroundVerified:false};
try{
 const deadline=Date.now()+45000;
 while(Date.now()<deadline){
  if(launchError)throw launchError;
  if(child.exitCode!==null)throw Error('Mac launcher exited before the engine was ready.');
  try{
   const url=new URL(fs.readFileSync(path.join(data,'session.url'),'utf8').trim());
   assert.equal(url.origin,`http://127.0.0.1:${port}`);
   const token=url.searchParams.get('launch');assert.match(token,/^[a-f0-9]{64}$/);
   base=url.origin;cookie='go_streams='+token;
   const ready=await fetch(base+'/api/ready',{headers:{Cookie:cookie},signal:AbortSignal.timeout(1500)});
   if(ready.ok)break;
  }catch{}
  await delay(200);
 }
 assert.ok(base&&cookie,'Native launcher did not provide a session.');
 const page=await fetch(base+'/',{headers:{Cookie:cookie},signal:AbortSignal.timeout(3000)});
 assert.equal(page.status,200);const html=await page.text();
 assert.match(html,/<html[^>]+translate="no"/);assert.match(html,/id="language-select"/);
 report.nativeLauncherStarted=true;report.authenticatedInterfaceAvailable=true;report.translationOptOutPresent=true;
 const stopped=await fetch(base+'/api/shutdown',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Go-Streams':'1'},body:'{}',signal:AbortSignal.timeout(5000)});
 assert.equal(stopped.status,200);
 const deadlineClose=Date.now()+10000;
 while(child.exitCode===null&&Date.now()<deadlineClose)await delay(100);
 assert.equal(child.exitCode,0,'Native launcher did not exit cleanly.');
 report.cleanShutdown=true;report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 if(child.exitCode===null&&!launchError)child.kill('SIGTERM');
 fs.mkdirSync('release',{recursive:true});
 fs.writeFileSync(`release/GoStreams-${version}-Mac-runtime-verification.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
