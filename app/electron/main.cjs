const {app,BrowserWindow,session,dialog,shell,Menu}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const net=require('node:net');
const {userPaths,migrateData,migratePreferences,discoverLegacy}=require('./data-policy.cjs');
const {rendererPreferences,activateWindow,wireNavigation,shutdownCoordinator}=require('./window-policy.cjs');

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
 }});
 // The loopback origin stays fixed so user preferences survive every upgrade.
 const profile=migratePreferences(paths.data),browserSession=session.fromPath(profile);
 browserSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 browserSession.setPermissionCheckHandler(()=>false);
 window=new BrowserWindow({width:1440,height:960,minWidth:760,minHeight:520,show:false,title:'Go Streams',icon:path.join(root,'public','icon.ico'),autoHideMenuBar:true,backgroundColor:'#f5f6fa',webPreferences:rendererPreferences(browserSession)});
 Menu.setApplicationMenu(null);
 wireNavigation(window.webContents,{base:backend.base,openExternal:url=>shell.openExternal(url)});
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
async function smokeCheck(browserSession){
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
 await browserSession.flushStorageData();await browserSession.cookies.flushStore();
 const proof={version:app.getVersion(),electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,sandbox:true,nodeHidden:renderer.nodeHidden,socialIcons:renderer.icons,priorSessionPreserved:prior,protectedProjectPreserved:prior};
 fs.writeFileSync(path.join(paths.data,prior?'electron-second-launch.json':'electron-first-launch.json'),JSON.stringify(proof,null,2));
 await requestQuit();
}
async function fail(error){
 const message=error.code==='EADDRINUSE'?'Close the previous Go Streams before opening the Electron edition. Its projects and sessions have been preserved.':String(error.message||error);
 if(smoke){fs.mkdirSync(paths.data,{recursive:true});fs.writeFileSync(path.join(paths.data,'electron-smoke-error.txt'),message);}
 else dialog.showErrorBox('Go Streams',message);
 quitting=true;await backend?.close().catch(()=>{});app.exit(1);
}
