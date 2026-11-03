import {windowsTool} from './system-tools.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {runProcess,AppError} from './core.mjs';

// Storage identity stays stable across the Streamland rename, preserving projects,
// vault keys and browser sessions when the installed application is upgraded.
export function defaultDataDirectory(root,{platform=process.platform,home=os.homedir(),localData=process.env.LOCALAPPDATA||path.join(home,'AppData','Local'),installed=fs.existsSync(path.join(root,'.installed'))&&fs.readFileSync(path.join(root,'.installed'),'utf8').trim()==='go-streams-installed-v1'}={}){
  if(platform==='darwin')return path.join(home,'Library','Application Support','Go Streams');
  return platform==='win32'&&installed?path.join(localData,'Go Streams','data'):path.join(root,'data');
}
export async function nativePicker({platform=process.platform,execute=runProcess}={}) {
  if (platform === 'darwin') {
    const script = `var app=Application.currentApplication(); app.includeStandardAdditions=true; try { var paths=app.chooseFile({withPrompt:"Escolha os vídeos para importar",multipleSelectionsAllowed:true}); JSON.stringify(paths.map(function(p){return p.toString();})); } catch(e) { if(e.errorNumber===-128) JSON.stringify([]); else throw e; }`;
    const result=await execute('/usr/bin/osascript',['-l','JavaScript','-e',script],{timeout:5*60000});
    const paths=JSON.parse(result.stdout.trim());
    if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||!p.startsWith('/')))throw new AppError('O seletor devolveu caminhos inválidos.');
    return paths;
  }
  if (platform !== 'win32') throw new AppError('Utilize a opção de introduzir caminhos neste sistema.');
  const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; $d.Filter='Vídeos|*.mp4;*.mkv;*.mov;*.webm;*.avi;*.m4v;*.ts'; if($d.ShowDialog() -eq 'OK'){ConvertTo-Json -InputObject @($d.FileNames) -Compress}else{'[]'}`;
  const result = await execute(windowsTool('powershell'), ['-NoProfile', '-STA', '-Command', script], { timeout: 5 * 60000 });
  return JSON.parse(result.stdout.trim());
}
export async function nativeDirectoryPicker({directory='',platform=process.platform,execute=runProcess,stat=fs.statSync}={}){
 const paths=platform==='win32'?path.win32:path.posix;
 // A saved folder can have been moved or deleted since the last recording.
 // Such a preset must not prevent the user from selecting its replacement.
 let initial='';
 if(typeof directory==='string'&&paths.isAbsolute(directory)&&!/[\x00-\x1f]/.test(directory)){
  try{if(stat(directory).isDirectory())initial=directory;}catch{}
 }
 let result;
 if(platform==='darwin'){
  const script='function run(argv){var app=Application.currentApplication();app.includeStandardAdditions=true;try{var options={withPrompt:"Choose a folder for local recordings"};if(argv[0])options.defaultLocation=Path(argv[0]);return JSON.stringify(app.chooseFolder(options).toString());}catch(e){if(e.errorNumber===-128)return "null";throw e;}}';
  result=await execute('/usr/bin/osascript',['-l','JavaScript','-e',script,'--',initial],{timeout:5*60000});
 }else if(platform==='win32'){
  // Encoding keeps quotes, Unicode and PowerShell metacharacters in folder names
  // as data, while allowing the native dialog to reopen at the current folder.
  const encoded=Buffer.from(initial,'utf8').toString('base64');
  const script='[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.FolderBrowserDialog;$d.Description="Choose a folder for local recordings";$d.ShowNewFolderButton=$true;$d.SelectedPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("'+encoded+'"));try{if($d.ShowDialog() -eq "OK"){ConvertTo-Json -InputObject $d.SelectedPath -Compress}else{"null"}}finally{$d.Dispose()}';
  result=await execute(windowsTool('powershell'),['-NoProfile','-STA','-Command',script],{timeout:5*60000});
 }else throw new AppError('Enter an absolute recording folder path on this system.');
 const selected=JSON.parse(result.stdout.trim());
 if(selected===null)return null;
 if(typeof selected!=='string'||!paths.isAbsolute(selected)||/[\x00-\x1f]/.test(selected))throw new AppError('The folder picker returned an invalid path.');
 return selected;
}
export function prepareBrowserProfile(directory) {
  const profile=path.join(directory,'desktop-browser');
  fs.mkdirSync(profile,{recursive:true});
  try { const fd=fs.openSync(path.join(profile,'First Run'),'wx');fs.closeSync(fd); }
  catch(error){if(error.code!=='EEXIST')throw error;}
  return profile;
}
export function openBrowser(url,{platform=process.platform,spawnProcess=spawn,exists=fs.existsSync,prepareProfile=prepareBrowserProfile,directory=process.env.GO_STREAMS_DATA||path.join(os.homedir(),'.go-streams-desktop')}={}) {
  if (platform === 'win32') {
    const candidates = [path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')];
    const browser = candidates.find(p => exists(p));
    if (browser) { const child = spawnProcess(browser, [`--app=${url}`, `--user-data-dir=${prepareProfile(directory)}`, '--profile-directory=Default', '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--hide-crash-restore-bubble', '--disable-sync', '--disable-features=msImplicitSignin,Translate,msEdgeTranslate', '--edge-skip-compat-layer-relaunch', '--window-size=1440,960','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'], { detached: true, stdio: 'ignore', windowsHide: false }); child.on('error', () => {}); child.unref(); return; }
    const child = spawnProcess(windowsTool('browser'), ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }); child.on('error', () => {}); child.unref();
  } else {
    if(platform==='darwin'){
      const browser=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(exists);
      // Launch Services brings the browser to the foreground. A separate
      // instance ensures app arguments are honoured even if it is already open.
      if(browser){const bundle=browser.slice(0,browser.indexOf('.app')+4);const child=spawnProcess('/usr/bin/open',['-n','-a',bundle,'--args',`--app=${url}`,'--disable-features=Translate,msEdgeTranslate','--window-size=1440,960','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],{detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref();return;}
    }
    const child = spawnProcess(platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref(); }
}

export async function showStartupError(message,{platform=process.platform,execute=runProcess}={}){
  if(platform!=='darwin')return;
  const script='function run(argv){var app=Application.currentApplication();app.includeStandardAdditions=true;app.displayAlert("Streamland",{message:argv[0]});}';
  await execute('/usr/bin/osascript',['-l','JavaScript','-e',script,'--',String(message).slice(0,2000)],{timeout:5*60000});
}
