function externalUrl(value){
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function appUrl(value,base){
 try{const u=new URL(value);return u.origin===base&&u.pathname==='/'&&!u.username&&!u.password;}catch{return false;}
}
function rendererPreferences(session){return {session,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,backgroundThrottling:false};}
function activateWindow(window){
 if(!window||window.isDestroyed())return;
 if(window.isMinimized())window.restore();
 window.show();window.moveTop();window.focus();
}
function wireNavigation(contents,{base,openExternal}){
 const external=value=>{const safe=externalUrl(value);if(safe)Promise.resolve(openExternal(safe)).catch(()=>{});};
 contents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
 contents.on('will-navigate',(event,url)=>{if(!appUrl(url,base)){event.preventDefault();external(url);}});
 contents.on('will-attach-webview',event=>event.preventDefault());
}
function activeWork(backend){return [...backend.studio.jobs.values()].some(job=>!job.ended)||Boolean(backend.studio.pendingImports.size||backend.studio.pendingPreparations.size||backend.studio.pendingOperations.size||backend.downloads.active.size);}
function shutdownCoordinator({backend,confirm,finish}){
 let pending=null,done=false;
 return async function requestQuit(){
  if(done)return true;
  if(pending)return pending;
  pending=(async()=>{
   if(activeWork(backend)&&!await confirm())return false;
   await backend.close();done=true;await finish();return true;
  })();
  try{return await pending;}finally{pending=null;}
 };
}
module.exports={externalUrl,appUrl,rendererPreferences,activateWindow,wireNavigation,shutdownCoordinator};
