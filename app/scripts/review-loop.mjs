// Repeated regression checks requested for the 1.x release. No real accounts,
// public broadcasts or external application installations are used by this suite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const requested=Number(process.argv[2]||10);
if(!Number.isInteger(requested)||requested<1||requested>10)throw Error('Use 1..10 review cycles.');
const output=path.join(root,'.tmp','review-loop');fs.mkdirSync(output,{recursive:true});
const release=path.join(root,'release');fs.mkdirSync(release,{recursive:true});
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const reportFile=path.join(release,`Streamland-${version}-review-${process.platform}-verification.json`);
function fingerprint(){
 const hash=crypto.createHash('sha256');
 function visit(relative){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const name=path.join(relative,entry.name);if(entry.isDirectory())visit(name);else if(/\.(?:[cm]?js|json|py|go|cs|html|css|md|nsi|txt)$/i.test(entry.name))hash.update(name.replaceAll('\\','/')+'\0').update(fs.readFileSync(path.join(root,name)));}}
 for(const directory of ['src','public','electron','scripts','test'])visit(directory);
 hash.update(fs.readFileSync(path.join(root,'package.json')));return hash.digest('hex');
}
const sourceHash=fingerprint();
const report={version,platform:process.platform,cyclesRequested:requested,cyclesCompleted:0,sourceSHA256:sourceHash,passed:false,cycles:[],realDevicesVerified:false,realProviderAccountsVerified:false};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
save();
try{
 const files=fs.readdirSync(path.join(root,'test')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join('test',name));
 for(let index=1;index<=requested;index++){
  if(fingerprint()!==sourceHash)throw Error('Source changed during review; restart the cycles on the final source.');
  const logFile=path.join(output,`cycle-${index}.log`),log=fs.createWriteStream(logFile);const started=Date.now();
  const child=spawn(process.execPath,['--test','--test-concurrency=1','--test-timeout=60000','--test-reporter=tap',...files],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  // Retain the full ordinary TAP run so an early failure is visible in CI logs.
  // The cap also bounds diagnostics if a subprocess emits excessive output.
  let tail='',timedOut=false;
  const consume=chunk=>{log.write(chunk);tail=(tail+chunk).slice(-2*1024*1024);};child.stdout.on('data',consume);child.stderr.on('data',consume);
  const watchdog=setTimeout(()=>{timedOut=true;child.kill();},360000).unref();
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}).finally(()=>clearTimeout(watchdog));
  await new Promise(resolve=>log.end(resolve));
  const count=key=>Number(new RegExp('^# '+key+' (\\d+)\\s*$','m').exec(tail)?.[1]??-1);
  const cycle={cycle:index,seconds:Math.round((Date.now()-started)/100)/10,exitCode:code,tests:count('tests'),passed:count('pass'),failed:count('fail'),cancelled:count('cancelled'),skipped:count('skipped')};
  report.cycles.push(cycle);save();console.log(JSON.stringify(cycle));
  if(code!==0||timedOut||cycle.failed!==0||cycle.cancelled!==0||cycle.tests<1){await new Promise(resolve=>process.stderr.write(tail,resolve));throw Error(`Review cycle ${index} failed${timedOut?' (timeout)':''}; see ${logFile}`);}
  report.cyclesCompleted=index;save();
 }
 if(fingerprint()!==sourceHash)throw Error('Source changed during review; restart the cycles on the final source.');
 report.passed=true;save();console.log(JSON.stringify({passed:true,cycles:requested,report:reportFile}));
}catch(error){report.error=error.message;save();throw error;}
