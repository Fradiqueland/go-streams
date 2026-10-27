import {prepareRuntime} from './vendor-runtime.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepareYtdlp,vendorFiles} from './vendor-ytdlp.mjs';
import {ytdlpPath} from '../src/tool-paths.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(command,args,timeout=180000){
  const result=spawnSync(command,args,{cwd:root,windowsHide:true,stdio:'inherit',timeout});
  if(result.error)throw result.error;if(result.status!==0)throw Error('Portable preparation stopped: '+path.basename(command));
}
const platform=process.argv.find(a=>a.startsWith('--platform='))?.slice(11)||process.platform;
try{
  if(!['win32','darwin','all'].includes(platform))throw Error('Unsupported portable platform');
  const platforms=platform==='all'?['win32','darwin']:[platform];
  await prepareYtdlp(root,{platforms});
  for(const p of platforms)await prepareRuntime(root,p);
  if(platforms.includes(process.platform)){
    const executable=ytdlpPath({},{root});
    const check=spawnSync(executable,['--ignore-config','--version'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:45000});
    if(check.status!==0||check.stdout.trim()!==vendorFiles(root,process.platform).manifest.version)throw Error('Bundled yt-dlp did not pass its local version check.');
    console.log('Bundled yt-dlp verified: '+check.stdout.trim());
  }
  run(process.execPath,['scripts/build.mjs','--platform='+platform]);
  run(process.platform==='win32'?'python':'python3',['scripts/package.py',path.join(root,'release'),platform]);
  console.log('Portable application ready in '+path.join(root,'release'));
}catch(error){
  console.error('Unable to finish portable package: '+error.message+(error.cause?.message?' ('+error.cause.message+')':''));
  console.error('Existing application data was not changed. Run this command again with Internet access.');
  process.exitCode=1;
}
