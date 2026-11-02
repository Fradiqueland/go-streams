const {app,BrowserWindow,session,dialog,shell,Menu,desktopCapturer}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const net=require('node:net');
const {userPaths,migrateData,migratePreferences,discoverLegacy}=require('./data-policy.cjs');
const {rendererPreferences,activateWindow,wireNavigation,activeWork,prepareRendererClose,cancelRendererClose,shutdownCoordinator}=require('./window-policy.cjs');
const {wireCapturePermissions,chooseCaptureSource}=require('./capture-policy.cjs');

app.setName('Go Streams');
app.setAppUserModelId('net.antoniofradique.gostreams');
app.enableSandbox();
const local=process.env.LOCALAPPDATA||path.join(app.getPath('home'),'AppData','Local');
const paths=userPaths(local,process.env.GO_STREAMS_DATA);
fs.mkdirSync(paths.host,{recursive:true});app.setPath('userData',paths.host);
let window,backend,requestQuit,quitting=false,quitRequests=0,rendererGone=false,quitErrorVisible=false,smokeCloseFixture;
const smoke=process.env.GO_STREAMS_ELECTRON_SMOKE==='1'&&Boolean(process.env.GO_STREAMS_DATA);
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>activateWindow(window));
 app.on('before-quit',event=>{if(!quitting){event.preventDefault();if(requestQuit)void requestQuit().catch(reportQuitFailure);else{quitting=true;app.quit();}}});
 app.on('window-all-closed',()=>{if(!quitting&&requestQuit)void requestQuit().catch(reportQuitFailure);});
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
  chooseSource:(sources,{systemAudio})=>chooseCaptureSource(sources,{systemAudio,showMessageBox:options=>dialog.showMessageBox(window,options)})
 });
 Menu.setApplicationMenu(null);
 wireNavigation(window.webContents,{base:backend.base,openExternal:url=>shell.openExternal(url),httpUrls:()=>backend.store.data.channels.flatMap(channel=>[channel.channelUrl,channel.producerUrl]).filter(Boolean)});
 browserSession.on('will-download',(event,item)=>{
  const url=item.getURL();if(!(url.startsWith(backend.base+'/')||url.startsWith('blob:'+backend.base+'/')))event.preventDefault();
 });
 const finish=async()=>{quitting=true;if(!window.isDestroyed())window.destroy();app.quit();};
 window.webContents.on('render-process-gone',()=>{rendererGone=true;});
 window.webContents.on('did-finish-load',()=>{rendererGone=false;});
 const coordinatedQuit=shutdownCoordinator({backend,finish,
  prepare:async()=>{
   await prepareRendererClose(window?.webContents,{base:backend.base,required:activeWork(backend),unavailable:rendererGone});
   if(smokeCloseFixture)await verifySmokeWindowClose();
  },
  cancel:()=>cancelRendererClose(window?.webContents,{base:backend.base,unavailable:rendererGone}),
  confirm:async()=>{
  if(smokeCloseFixture)return true;
  const result=await dialog.showMessageBox(window,{type:'question',buttons:['Keep Go Streams open','Stop operations and close'],defaultId:0,cancelId:0,title:'Go Streams',message:'There are active streams or operations. Stop them and close Go Streams?'});
  return result.response===1;
 }});
 requestQuit=async()=>{quitRequests++;try{return await coordinatedQuit();}finally{quitRequests--;}};
 window.on('close',event=>{if(!quitting){event.preventDefault();if(smokeCloseFixture)smokeCloseFixture.nativeCloseEvent=true;void requestQuit().catch(reportQuitFailure);}});
 backend.server.on('close',()=>{if(!quitting&&!quitRequests)void finish();});
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
 const proofPath=path.join(paths.data,prior?'electron-second-launch.json':'electron-first-launch.json');
 await prepareSmokeWindowClose({proof,proofPath,runProcess});
 window.close();await requestQuit();
}
async function prepareSmokeWindowClose({proof,proofPath,runProcess}){
 const evaluate=code=>window.webContents.executeJavaScript(code,true),pause=()=>new Promise(resolve=>setTimeout(resolve,50));
 const waitFor=async(code,label)=>{const deadline=Date.now()+10000;while(!await evaluate(code)){if(Date.now()>deadline)throw Error('Native recording close setup timed out: '+label);await pause();}};
 await evaluate("location.hash='recorder'");await waitFor("Boolean(document.querySelector('.recorder-studio [name=mode]'))",'recorder panel');
 await evaluate(`(()=>{
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d');
  const state=window.__nativeCloseSmoke={chunks:0,starts:0,color:'#cc2233'};
  const draw=()=>{context.fillStyle=state.color;context.fillRect(0,0,640,360);};draw();state.timer=setInterval(draw,33);
  navigator.mediaDevices.getUserMedia=async()=>canvas.captureStream(30);
  const NativeRecorder=window.MediaRecorder;window.MediaRecorder=class extends NativeRecorder{start(){state.starts++;this.addEventListener('dataavailable',event=>{if(event.data.size)state.chunks++;});return super.start(100000);}};
  const panel=document.querySelector('.recorder-studio');
  for(const [name,value]of Object.entries({mode:'camera',sound:'none',quality:'720',countdown:'0',aspect:'original',directory:${JSON.stringify(backend.recordings.root)}})){
   const field=panel.querySelector('[name="'+name+'"]');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
  }
  panel.querySelector('[name=askFolder]').checked=false;
  panel.querySelector('[data-recorder=prepare]').click();
 })()`);
 await waitFor("Boolean(document.querySelector('.recorder-preview').srcObject)&&!document.querySelector('[data-recorder=start]').disabled",'preview');
 await evaluate("document.querySelector('[data-recorder=start]').click()");
 await waitFor("!document.querySelector('[data-recorder=stop]').disabled",'recording');
 await new Promise(resolve=>setTimeout(resolve,350));await evaluate("window.__nativeCloseSmoke.color='#22cc88'");await new Promise(resolve=>setTimeout(resolve,450));
 const before=await evaluate('({chunks:window.__nativeCloseSmoke.chunks,starts:window.__nativeCloseSmoke.starts})');
 const records=[...backend.recordings.active.values()];
 if(before.chunks!==0||before.starts!==1||records.length!==1||records[0].sequence!==0)throw Error('Native close must begin before the recording produces its first chunk.');
 smokeCloseFixture={proof,proofPath,runProcess,record:records[0],nativeCloseEvent:false};
}
async function verifySmokeWindowClose(){
 const fixture=smokeCloseFixture,{record,runProcess}=fixture,id=record.item.id;
 const renderer=await window.webContents.executeJavaScript('({chunks:window.__nativeCloseSmoke.chunks,inert:document.body.inert,released:!document.querySelector(".recorder-preview").srcObject})');
 if(!fixture.nativeCloseEvent||!backend.server.listening||!renderer.inert||!renderer.released||renderer.chunks<1||record.sequence<1||record.item.status!=='completed'||backend.recordings.active.has(id)||backend.recordings.finalizing.has(id))throw Error('Native close did not drain and finalize the recording before backend shutdown.');
 const {toolsFor}=await import(pathToFileURL(path.join(path.resolve(__dirname,'..'),'src','core.mjs')).href),tools=toolsFor(backend.store.data.settings),file=backend.recordings.media(id),pixels=path.join(paths.data,id+'-tail.rgb');
 const {stdout}=await runProcess(tools.ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],{timeout:10000}),info=JSON.parse(stdout);
 if(!info.streams.some(stream=>stream.codec_type==='video'&&stream.codec_name==='h264')||Number(info.format.duration)<.5)throw Error('Native close produced an invalid or truncated MP4.');
 try{
  await runProcess(tools.ffmpeg,['-v','error','-sseof','-0.12','-i',file,'-frames:v','1','-vf','crop=2:2:4:4','-pix_fmt','rgb24','-f','rawvideo','-y',pixels],{timeout:10000});
  const rgb=fs.readFileSync(pixels);if(rgb.length!==12||[34,204,136].some((value,index)=>Math.abs(rgb[index]-value)>26))throw Error('Native close lost the final recording frame.');
 }finally{try{fs.unlinkSync(pixels);}catch(error){if(error.code!=='ENOENT')throw error;}}
 fixture.proof.nativeWindowClose={nativeCloseEvent:true,noChunksBeforeClose:true,rendererDrainedBeforeBackend:true,finalChunkUploaded:true,recordingFinalized:true,finalFramePreserved:true};
 fs.writeFileSync(fixture.proofPath,JSON.stringify(fixture.proof,null,2));
}
async function fail(error){
 const message=error.code==='EADDRINUSE'?'Close the previous Go Streams before opening the Electron edition. Its projects and sessions have been preserved.':String(error.message||error);
 if(smoke){fs.mkdirSync(paths.data,{recursive:true});fs.writeFileSync(path.join(paths.data,'electron-smoke-error.txt'),message);}
 else dialog.showErrorBox('Go Streams',message);
 quitting=true;await backend?.close().catch(()=>{});app.exit(1);
}
async function reportQuitFailure(error){
 if(smoke)return fail(error);
 if(quitErrorVisible)return;
 quitErrorVisible=true;
 try{activateWindow(window);await dialog.showMessageBox(window,{type:'error',title:'Go Streams',message:'Go Streams could not finish closing.',detail:String(error.message||error)+'\nThe window has been kept open. You can retry closing.',buttons:['Keep open']});}
 finally{quitErrorVisible=false;}
}
