import {windowsTool} from './system-tools.mjs';
import {spawn} from 'node:child_process';

const ownedGroup=Symbol('GoStreamsOwnedProcessGroup');
export function spawnOwnedTool(command,args,options,{spawnProcess=spawn,platform=process.platform}={}){
  const child=spawnProcess(command,args,{...options,detached:platform!=='win32'});
  if(platform!=='win32')child[ownedGroup]=true;
  return child;
}
// Operates only on a child handle owned by this application, never a process name.
export async function stopProcessTree(child,{spawnProcess=spawn,platform=process.platform,killGroup=process.kill}={}) {
  if(!child || child.exitCode !== null && child.exitCode !== undefined)return true;
  if(!Number.isInteger(child.pid)){child.kill();return true;}
  if(platform!=='win32'){
    if(child[ownedGroup]&&Number.isInteger(child.pid)&&child.pid>1){
      try{killGroup(-child.pid,'SIGKILL');return true;}catch(error){if(error.code==='ESRCH')return true;}
    }
    child.kill();return false;
  }
  return new Promise(resolve=>{
    let settled=false;
    const finish=success=>{if(settled)return;settled=true;clearTimeout(timer);if(!success)child.kill();resolve(success);};
    let killer;
    const timer=setTimeout(()=>{killer?.kill();finish(false);},10000);
    try{
      killer=spawnProcess(windowsTool('taskkill'),['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});
      killer.on('error',()=>finish(false));killer.on('close',code=>finish(code===0));
    }catch{finish(false);}
  });
}
