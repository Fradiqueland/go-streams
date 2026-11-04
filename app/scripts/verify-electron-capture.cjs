// Run as an isolated Electron application in CI. Capture only this fixture's
// own WebContents; no desktop, camera, microphone or system audio is selected.
const {app,BrowserWindow,session,ipcMain,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {wireCapturePermissions}=require('../electron/capture-policy.cjs');
const {openCapturePicker,pickerLabels}=require('../electron/capture-picker.cjs');
const root=process.env.STREAMLAND_CAPTURE_TEST_ROOT;
if(!root||!path.isAbsolute(root))throw Error('An explicit capture test directory is required.');
fs.mkdirSync(root,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.enableSandbox();
app.on('window-all-closed',()=>{});
const report={version:require('../package.json').version,electron:process.versions.electron,passed:false,sandbox:true,physicalDevicesVerified:false,nativeScreenPickerVerified:false,requests:[],captures:[]};
let server,win,timer;
const save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));
async function finish(error){
 clearTimeout(timer);if(error)report.error=String(error.stack||error);
 try{if(win&&!win.isDestroyed())win.destroy();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}catch(cleanup){report.error=String(cleanup.stack||cleanup);report.passed=false;}
 save();app.exit(report.passed&&!report.error?0:1);
}
timer=setTimeout(()=>void finish(Error('Native display capture verification timed out.')),60000);
app.whenReady().then(async()=>{
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Streamland native capture fixture</title><body style="background:#114477;color:white"><h1>Streamland synthetic test surface</h1><script>let color=false;setInterval(()=>{color=!color;document.body.style.background=color?"#114477":"#447711"},100)</script></body>');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port,ses=session.fromPath(path.join(root,'browser-profile'));
 win=new BrowserWindow({show:true,width:640,height:480,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 let selections=0;
 const permissions={
  setPermissionCheckHandler:fn=>ses.setPermissionCheckHandler(fn),
  setPermissionRequestHandler:fn=>ses.setPermissionRequestHandler(fn),
  setDisplayMediaRequestHandler:fn=>ses.setDisplayMediaRequestHandler((request,callback)=>{
   report.requests.push({origin:request.securityOrigin,mainFrame:request.frame===win.webContents.mainFrame,userGesture:request.userGesture,videoRequested:request.videoRequested,audioRequested:request.audioRequested});
   fn(request,callback);
  })
 };
 wireCapturePermissions(permissions,{contents:win.webContents,base,
  confirmMedia:async()=>true,
  getSources:async()=>[win.webContents.mainFrame],
  chooseSource:async sources=>{selections++;return sources[0];}
 });
 await win.loadURL(base+'/');win.show();win.focus();win.webContents.focus();
 const syntheticSources=[{id:'screen:fixture',name:'Fixture screen'},...Array.from({length:23},(_,i)=>({id:'window:fixture-'+(i+1),name:'Test source '+(i+1)}))].map(source=>({...source,thumbnail:nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=')}));
 report.pickerLanguages=[];
 for(const locale of ['pt-PT','fr','ar']){
  const picking=openCapturePicker({parent:win,BrowserWindow,ipcMain,sources:syntheticSources,systemAudio:true,locale});let picker;const deadline=Date.now()+10000;
  while(Date.now()<deadline){picker=BrowserWindow.getAllWindows().find(candidate=>candidate!==win&&!candidate.isDestroyed());if(picker&&await picker.webContents.executeJavaScript("document.querySelectorAll('.source').length===24").catch(()=>false))break;await new Promise(resolve=>setTimeout(resolve,50));}
  if(!picker||Date.now()>=deadline)throw Error('Capture source picker did not render.');
  const labels=pickerLabels(locale),state=await picker.webContents.executeJavaScript("({heading:document.querySelector('h1').textContent,dir:document.documentElement.dir,disabled:document.querySelector('#share').disabled})");
  if(state.heading!==labels.heading||state.dir!==(locale==='ar'?'rtl':'ltr')||!state.disabled)throw Error('Capture picker locale or consent state is incorrect.');
  ipcMain.emit('streamland-picker-select',{sender:win.webContents},syntheticSources[0].id);
  if(picker.isDestroyed())throw Error('An unrelated renderer selected a capture source.');
  await picker.webContents.executeJavaScript("const search=document.querySelector('#search');search.value='Test source 23';search.dispatchEvent(new Event('input'));document.querySelector('.source').click()");
  if(locale==='pt-PT')fs.writeFileSync(path.join(root,'capture-picker-pt.png'),(await picker.webContents.capturePage()).toPNG());
  await picker.webContents.executeJavaScript(locale==='ar'?"document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))":"document.querySelector('#share').click()");
  const selected=await picking;if(locale==='ar'?selected!==null:selected!==syntheticSources.at(-1))throw Error('Capture picker search, selection or cancellation failed.');report.pickerLanguages.push(locale);
 }
 report.sourcePickerLayout=true;report.sourcePickerSearch=true;report.sourcePickerConsent=true;report.sourcePickerRTL=true;
 win.show();win.focus();win.webContents.focus();
 await new Promise(resolve=>setTimeout(resolve,500));
 for(const [surface,options]of [['recorder',{video:{frameRate:30},audio:false,systemAudio:'include'}],['liveStudio',{video:{frameRate:30},audio:false}]]){
  const captured=await win.webContents.executeJavaScript(`(async()=>{
   let stream,recorder;
   try{
    stream=await navigator.mediaDevices.getDisplayMedia(${JSON.stringify(options)});
    const tracks=stream.getVideoTracks();if(tracks.length!==1||tracks[0].readyState!=='live')throw Error('Native video track is not live.');
    let bytes=0,recordingError;
    recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    const stopped=new Promise(resolve=>{recorder.onstop=resolve;});
    recorder.ondataavailable=event=>{bytes+=event.data.size;};recorder.onerror=event=>{recordingError=event.error||Error('Native encoder failed.');};
    recorder.start(100);const deadline=Date.now()+10000;
    while(!bytes&&!recordingError&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    if(recordingError)throw recordingError;
    recorder.stop();await stopped;if(!bytes)throw Error('Native capture produced no recorded bytes.');
    return {liveTrack:true,recordedBytes:bytes};
   }finally{if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(track=>track.stop());}
  })()`,true);
  report.captures.push({surface,...captured});
 }
 if(selections!==2||report.requests.length!==2||report.requests.some(r=>!r.mainFrame||!r.userGesture||!r.videoRequested))throw Error('Native capture bypassed source authorization.');
 report.freshSelectionForEachCapture=true;report.ownFixtureSurfaceOnly=true;report.passed=true;
 await finish();
}).catch(error=>void finish(error));
