import {windowsTool} from './system-tools.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {runProcess,AppError} from './core.mjs';

export function defaultDataDirectory(root,{platform=process.platform,home=os.homedir()}={}){
  return platform==='darwin'?path.join(home,'Library','Application Support','Go Streams'):path.join(root,'data');
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
    if (browser) { const child = spawnProcess(browser, [`--app=${url}`, `--user-data-dir=${prepareProfile(directory)}`, '--profile-directory=Default', '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--hide-crash-restore-bubble', '--disable-sync', '--disable-features=msImplicitSignin', '--edge-skip-compat-layer-relaunch', '--window-size=1440,960'], { detached: true, stdio: 'ignore', windowsHide: false }); child.on('error', () => {}); child.unref(); return; }
    const child = spawnProcess(windowsTool('browser'), ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }); child.on('error', () => {}); child.unref();
  } else {
    if(platform==='darwin'){
      const browser=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(exists);
      if(browser){const child=spawnProcess(browser,[`--app=${url}`,'--window-size=1440,960'],{detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref();return;}
    }
    const child = spawnProcess(platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref(); }
}

export async function showStartupError(message,{platform=process.platform,execute=runProcess}={}){
  if(platform!=='darwin')return;
  const script='function run(argv){var app=Application.currentApplication();app.includeStandardAdditions=true;app.displayAlert("Go Streams",{message:argv[0]});}';
  await execute('/usr/bin/osascript',['-l','JavaScript','-e',script,'--',String(message).slice(0,2000)],{timeout:5*60000});
}
