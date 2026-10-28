import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const application=path.resolve(process.argv[2]);
const exe=path.join(application,'GoStreams.exe'),source=path.join(application,'resources','app');
const parent=path.join(root,'.tmp');fs.mkdirSync(parent,{recursive:true});
const work=fs.mkdtempSync(path.join(parent,'electron-runtime-check-'));
async function run(args,extraEnv={},timeout=90000){
 const env={...process.env,...extraEnv};if(!extraEnv.ELECTRON_RUN_AS_NODE)delete env.ELECTRON_RUN_AS_NODE;
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{cwd:application,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Electron runtime verification timed out. '+err));},timeout);
  child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>err+=data);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error('Electron exited '+code+': '+err));});
 });
}
const data=path.join(work,'data');
const environment={LOCALAPPDATA:path.join(work,'LocalAppData'),GO_STREAMS_DATA:data,GO_STREAMS_ELECTRON_SMOKE:'1',GO_STREAMS_LEGACY_DATA:''};
const report={version:JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8')).version,work};
try{
 const code=`import fs from 'node:fs';import path from 'node:path';
 const {toolsFor,runProcess,probe,Vault}=await import(${JSON.stringify(pathToFileURL(path.join(source,'src/core.mjs')).href)});
 const {createApplication}=await import(${JSON.stringify(pathToFileURL(path.join(source,'src/server.mjs')).href)});
 const tools=toolsFor({});for(const value of Object.values(tools))if(!value.startsWith(${JSON.stringify(source+path.sep)}))throw Error('External runtime selected');
 const clip=${JSON.stringify(path.join(work,'clip.mp4'))};await runProcess(tools.ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','1','-c:v','libx264','-preset','ultrafast','-y',clip]);
 const app=await createApplication({directory:${JSON.stringify(path.join(work,'engine-data'))},listen:false,clock:false});
 try{await app.studio.importMedia([clip]);const id=app.studio.saveChannel({name:'Electron engine check',url:'rtmp://127.0.0.1:9/live',key:'ELECTRON-ENGINE-TEST'});const key=app.store.data.channels.find(c=>c.id===id).secret;
 if(new Vault(app.store.directory).decrypt(key)!=='ELECTRON-ENGINE-TEST')throw Error('Protected project failed to reopen');
 const video=await probe(clip,tools.ffprobe);if(video.duration<0.9)throw Error('Bundled video was truncated');
 await runProcess(tools.ytdlp,['--ignore-config','--version']);console.log(JSON.stringify({electron:process.versions.electron,node:process.version,PATH:process.env.PATH,includedTools:true,protectedCredentialsReopened:true,videoSeconds:video.duration}));
 }finally{await app.close();}`;
 const engine=await run(['--input-type=module','-e',code],{ELECTRON_RUN_AS_NODE:'1',PATH:''});
 report.engine=JSON.parse(engine.trim().split(/\r?\n/).at(-1));
 await run([],{...environment,GO_STREAMS_ELECTRON_EXPECT_EXISTING:'0'});
 report.firstLaunch=JSON.parse(fs.readFileSync(path.join(data,'electron-first-launch.json'),'utf8'));
 await run([],{...environment,GO_STREAMS_ELECTRON_EXPECT_EXISTING:'1'});
 report.secondLaunch=JSON.parse(fs.readFileSync(path.join(data,'electron-second-launch.json'),'utf8'));
 assert.equal(report.secondLaunch.priorSessionPreserved,true);assert.equal(report.secondLaunch.protectedProjectPreserved,true);
 report.passed=true;
}catch(error){report.passed=false;report.error=error.message;console.error(error.message);process.exitCode=1;}
fs.writeFileSync(path.join(root,'release','GoStreams-'+report.version+'-Electron-runtime-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
