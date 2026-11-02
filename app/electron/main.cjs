const {app,BrowserWindow,session,dialog,shell,Menu,desktopCapturer}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const net=require('node:net');
const {userPaths,migrateData,migratePreferences,discoverLegacy}=require('./data-policy.cjs');
const {rendererPreferences,activateWindow,wireNavigation,shutdownCoordinator}=require('./window-policy.cjs');
const {wireCapturePermissions}=require('./capture-policy.cjs');

app.setName('Go Streams');
app.setAppUserModelId('net.antoniofradique.gostreams');
app.enableSandbox();
const local=process.env.LOCALAPPDATA||path.join(app.getPath('home'),'AppData','Local');
const paths=userPaths(local,process.env.GO_STREAMS_DATA);
fs.mkdirSync(paths.host,{recursive:true});app.setPath('userData',paths.host);
let window,backend,requestQuit,quitting=false;
const smoke=process.env.GO_STREAMS_ELECTRON_SMOKE==='1'&&Boolean(process.env.GO_STREAMS_DATA);
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>activateWindow(window));
 app.on('before-quit',event=>{if(!quitting){event.preventDefault();if(requestQuit)void requestQuit().catch(fail);else{quitting=true;app.quit();}}});
 app.on('window-all-closed',()=>{if(!quitting&&requestQuit)void requestQuit().catch(fail);});
 app.whenReady().then(start).catch(fail);
}
function legacySettings(){
 if(process.env.GO_STREAMS_LEGACY_DATA)return {legacy:process.env.GO_STREAMS_LEGACY_DATA};
 try{
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const code="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Antonio Fradique\\Go Streams' -ErrorAction SilentlyContinue;if($null -ne $p){@{legacy=$p.LegacyDataDirectory;source=$p.LegacyPortableRoot}|ConvertTo-Json -Compress}else{'{}'}";
  return JSON.parse(execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,encoding:'utf8',timeout:10000}).replace(/^\uFEFF/,''));
 }catch{return {};}
}
async function start(){
 const port=Number(process.env.GO_STREAMS_PORT||4317);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local port.');
 const busy=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});let settled=false;const done=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};socket.once('connect',()=>done(true));socket.once('error',()=>done(false));socket.setTimeout(1000,()=>done(false));});
 if(busy){const error=Error('The local port is in use.');error.code='EADDRINUSE';throw error;}
 if((!process.env.GO_STREAMS_DATA||process.env.GO_STREAMS_LEGACY_DATA)&&(!fs.existsSync(paths.data)||fs.readdirSync(paths.data).length===0)){
  const legacy=legacySettings();migrateData(paths.data,legacy.legacy||discoverLegacy(legacy.source));
 }
 fs.mkdirSync(paths.data,{recursive:true});
 const root=path.resolve(__dirname,'..');
 const {createApplication}=await import(pathToFileURL(path.join(root,'src','server.mjs')).href);
 backend=await createApplication({directory:paths.data,port,picker:async()=>{
  const result=await dialog.showOpenDialog(window,{title:'Import videos',properties:['openFile','multiSelections'],filters:[{name:'Videos',extensions:['mp4','mkv','mov','webm','avi','m4v','ts']}]});
  return result.canceled?[]:result.filePaths;
 },folderPicker:async({directory})=>{
  const result=await dialog.showOpenDialog(window,{title:'Choose a folder for local recordings',defaultPath:directory,properties:['openDirectory','createDirectory']});
  return result.canceled?null:result.filePaths[0]||null;
 }});
 // The loopback origin stays fixed so user preferences survive every upgrade.
 const profile=migratePreferences(paths.data),browserSession=session.fromPath(profile);
 window=new BrowserWindow({width:1440,height:960,minWidth:760,minHeight:520,show:false,title:'Go Streams',icon:path.join(root,'public','icon.ico'),autoHideMenuBar:true,backgroundColor:'#f5f6fa',webPreferences:rendererPreferences(browserSession)});
 wireCapturePermissions(browserSession,{contents:window.webContents,base:backend.base,
  confirmMedia:async types=>{
   const devices=types.includes('video')?(types.includes('audio')?'camera and microphone':'camera'):'microphone';
   const result=await dialog.showMessageBox(window,{type:'question',title:'Go Streams - Live capture',message:`Allow Go Streams to use your ${devices} for the local preview?`,detail:'Broadcasting starts only after you select destinations and press Start live broadcast.',buttons:['Cancel','Allow'],defaultId:0,cancelId:0});
   return result.response===1;
  },
  getSources:()=>desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}}),
  chooseSource:async(sources,{systemAudio})=>{
   if(!sources.length)return null;
   const options=sources.slice(0,20);
   const result=await dialog.showMessageBox(window,{type:'question',title:'Go Streams — Share screen or window',message:'Choose what to share',detail:systemAudio?'System audio will also be captured. Your microphone is controlled separately.':'Only the selected screen or window will be captured.',buttons:['Cancel',...options.map(s=>s.name.slice(0,100))],defaultId:0,cancelId:0});
   return result.response>0?options[result.response-1]:null;
  }
 });
 Menu.setApplicationMenu(null);
 wireNavigation(window.webContents,{base:backend.base,openExternal:url=>shell.openExternal(url),httpUrls:()=>backend.store.data.channels.flatMap(channel=>[channel.channelUrl,channel.producerUrl]).filter(Boolean)});
 browserSession.on('will-download',(event,item)=>{
  const url=item.getURL();if(!(url.startsWith(backend.base+'/')||url.startsWith('blob:'+backend.base+'/')))event.preventDefault();
 });
 const finish=async()=>{quitting=true;if(!window.isDestroyed())window.destroy();app.quit();};
 requestQuit=shutdownCoordinator({backend,finish,confirm:async()=>{
  const result=await dialog.showMessageBox(window,{type:'question',buttons:['Keep Go Streams open','Stop operations and close'],defaultId:0,cancelId:0,title:'Go Streams',message:'There are active streams or operations. Stop them and close Go Streams?'});
  return result.response===1;
 }});
 window.on('close',event=>{if(!quitting){event.preventDefault();void requestQuit().catch(fail);}});
 backend.server.on('close',()=>{if(!quitting)void finish();});
 window.once('ready-to-show',()=>{if(!smoke)activateWindow(window);});
 await window.loadURL(backend.url);
 if(smoke)await smokeCheck(browserSession);
}
async function smokeRecordingDownloads(browserSession,runProcess){
 const id=require('node:crypto').randomUUID(),recordings=backend.recordings,source=path.join(recordings.root,id+'.mp4'),downloads=[];
 const {toolsFor}=await import(pathToFileURL(path.join(path.resolve(__dirname,'..'),'src','core.mjs')).href);
 const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
 try{
  await runProcess(toolsFor(backend.store.data.settings).ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=10','-t','0.5','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-y',source],{timeout:15000});
  const expected=fs.readFileSync(source),created=new Date().toISOString();
  recordings.items.unshift({id,created,ended:created,status:'completed',format:'mp4',kind:'video',bytes:expected.length,error:''});recordings.save();
  for(const [route,scope]of [['recorder','.recorder-files'],['capture','.recording-files']]){
   const href='/api/recordings/'+id+'/file',selector=scope+' a[href="'+href+'"]',destination=path.join(recordings.root,id+'-'+route+'-download.mp4');downloads.push(destination);
   await window.webContents.executeJavaScript('location.hash='+JSON.stringify(route));
   const deadline=Date.now()+15000;
   while(!await window.webContents.executeJavaScript('Boolean(document.querySelector('+JSON.stringify(selector)+'))')){
    if(Date.now()>deadline)throw Error('Recording download link did not appear: '+route);
    await pause();
   }
   const before=window.webContents.getURL();
   let handler,timer,downloadItem;
   const received=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>{downloadItem?.cancel();reject(Error('Recording download did not finish: '+route));},15000);
    handler=(event,item)=>{
     if(item.getURL()!==backend.base+href)return;
     downloadItem=item;
     try{if(item.getFilename()!=='GoStreams-'+id+'.mp4')throw Error('Recording download filename differs: '+route);item.setSavePath(destination);item.once('done',(_,state)=>state==='completed'?resolve():reject(Error('Recording download failed: '+state)));}catch(error){item.cancel();reject(error);}
    };
    browserSession.on('will-download',handler);
   });
   try{
    await Promise.all([received,window.webContents.executeJavaScript('document.querySelector('+JSON.stringify(selector)+').click()',true)]);
    if(window.webContents.getURL()!==before)throw Error('Recording download navigated away from the studio.');
    if(!fs.readFileSync(destination).equals(expected))throw Error('Recording download bytes differ: '+route);
   }finally{clearTimeout(timer);browserSession.removeListener('will-download',handler);}
  }
  return {recorder:true,liveStudio:true,bytesVerified:true,navigationPreserved:true};
 }finally{
  recordings.items=recordings.items.filter(item=>item.id!==id);recordings.save();
  for(const file of [source,...downloads])try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
async function smokeCheck(browserSession){
 const root=path.resolve(__dirname,'..');
 const {runProcess}=await import(pathToFileURL(path.join(root,'src','core.mjs')).href);
 const {downloaderEnvironment}=await import(pathToFileURL(path.join(root,'src','tool-paths.mjs')).href);
 // Verify from the real GUI process, which must not inherit Node mode itself.
 // --version alone on yt-dlp cannot exercise its nested JavaScript runtime.
 if(process.env.ELECTRON_RUN_AS_NODE)throw Error('Electron smoke must start as a GUI application.');
 const runtime=await runProcess(process.execPath,['-p','"go-streams-node-runtime:"+process.versions.node'],{env:downloaderEnvironment(),timeout:15000});
 if(runtime.stdout.trim()!=='go-streams-node-runtime:'+process.versions.node)throw Error('Bundled JavaScript runtime did not start in Node mode.');
 const started=Date.now();
 while(!await window.webContents.executeJavaScript("Boolean(document.querySelector('#content h1'))")){
  if(Date.now()-started>20000)throw Error('Electron interface did not become ready.');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 const prior=process.env.GO_STREAMS_ELECTRON_EXPECT_EXISTING==='1';
 const renderer=await window.webContents.executeJavaScript(`({nodeHidden:typeof require==='undefined'&&typeof process==='undefined',icons:document.querySelectorAll('.creator-social-links a').length,saved:localStorage.getItem('electron-persistence-smoke')})`);
 if(!renderer.nodeHidden||renderer.icons!==9)throw Error('Electron renderer verification failed.');
 if(prior){
  if(renderer.saved!=='preserved')throw Error('Electron session preferences were reset.');
  const channel=backend.store.data.channels.find(c=>c.name==='Electron persistence check');
  if(!channel||backend.studio.vault.decrypt(channel.secret)!=='LOCAL-ELECTRON-SMOKE-SECRET')throw Error('Existing protected project was reset.');
 }else{
  backend.studio.saveChannel({name:'Electron persistence check',url:'rtmp://127.0.0.1:9/live',key:'LOCAL-ELECTRON-SMOKE-SECRET'});
  await window.webContents.executeJavaScript("localStorage.setItem('electron-persistence-smoke','preserved')");
 }
 const recordingDownloads=await smokeRecordingDownloads(browserSession,runProcess);
 await browserSession.flushStorageData();await browserSession.cookies.flushStore();
 const proof={version:app.getVersion(),electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,sandbox:true,nodeHidden:renderer.nodeHidden,socialIcons:renderer.icons,priorSessionPreserved:prior,protectedProjectPreserved:prior,downloaderJavaScriptRuntimeVerified:true,recordingDownloads};
 fs.writeFileSync(path.join(paths.data,prior?'electron-second-launch.json':'electron-first-launch.json'),JSON.stringify(proof,null,2));
 await requestQuit();
}
async function fail(error){
 const message=error.code==='EADDRINUSE'?'Close the previous Go Streams before opening the Electron edition. Its projects and sessions have been preserved.':String(error.message||error);
 if(smoke){fs.mkdirSync(paths.data,{recursive:true});fs.writeFileSync(path.join(paths.data,'electron-smoke-error.txt'),message);}
 else dialog.showErrorBox('Go Streams',message);
 quitting=true;await backend?.close().catch(()=>{});app.exit(1);
}
