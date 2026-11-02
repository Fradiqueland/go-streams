function externalUrl(value,{httpUrls=[]}={}){
 try{
  const url=new URL(value);
  const savedHttp=url.protocol==='http:'&&httpUrls.some(saved=>{try{return new URL(saved).href===url.href;}catch{return false;}});
  return (url.protocol==='https:'||savedHttp)&&!url.username&&!url.password?url.href:null;
 }catch{return null;}
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
function wireNavigation(contents,{base,openExternal,httpUrls=()=>[]}){
 const external=value=>{const safe=externalUrl(value,{httpUrls:httpUrls()});if(safe)try{Promise.resolve(openExternal(safe)).catch(()=>{});}catch{}};
 contents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
 contents.on('will-navigate',(event,url)=>{if(!appUrl(url,base)){event.preventDefault();external(url);}});
 contents.on('will-attach-webview',event=>event.preventDefault());
}
function activeWork(backend){return [...backend.studio.jobs.values()].some(job=>!job.ended)||Boolean(backend.studio.pendingImports.size||backend.studio.pendingPreparations.size||backend.studio.pendingOperations.size||backend.downloads.active.size||backend.recordings?.active.size||backend.recordings?.finalizing.size||backend.feeds?.active.size);}
async function prepareRendererClose(contents,{base,required=false,unavailable=false}={}){
 const usable=contents&&!contents.isDestroyed()&&!unavailable&&appUrl(contents.getURL(),base);
 if(!usable){if(required)throw Error('The recording interface is unavailable. Keep Go Streams open and retry closing after the recording has finished.');return;}
 const prepared=await contents.executeJavaScript("(async()=>{if(typeof window.GoStreamsPrepareClose!=='function')return false;await window.GoStreamsPrepareClose();return true;})()");
 if(!prepared&&required)throw Error('The recording interface is still starting. Wait for it to become ready before closing Go Streams.');
}
async function cancelRendererClose(contents,{base,unavailable=false}={}){
 if(contents&&!contents.isDestroyed()&&!unavailable&&appUrl(contents.getURL(),base))await contents.executeJavaScript("if(typeof window.GoStreamsCancelClose==='function')window.GoStreamsCancelClose()");
}
function shutdownCoordinator({backend,confirm,finish,prepare=async()=>{},cancel=async()=>{}}){
 let pending=null,done=false,backendClosed=false;
 return function requestQuit(){
  if(done)return Promise.resolve(true);
  if(pending)return pending;
  const task=Promise.resolve().then(async()=>{
   try{
    if(!backendClosed){
     if(activeWork(backend)&&!await confirm())return false;
     await prepare();
     const wasListening=backend.server?.listening===true;
     try{await backend.close();backendClosed=true;}
     catch(error){if(wasListening&&backend.server.listening===false)backendClosed=true;throw error;}
    }
    await finish();done=true;return true;
   }catch(error){try{await cancel();}catch{}throw error;}
  });
  pending=task.finally(()=>{pending=null;});return pending;
 };
}
module.exports={externalUrl,appUrl,rendererPreferences,activateWindow,wireNavigation,activeWork,prepareRendererClose,cancelRendererClose,shutdownCoordinator};
