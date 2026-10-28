import {universalFixture} from './macho-fixture.mjs';
import {inspectMachO} from '../scripts/macho.mjs';
import {windowsTool} from '../src/system-tools.mjs';
import {runtimeFixture} from './runtime-fixture.mjs';
import {vendorFixture} from './vendor-fixture.mjs';
import {uiHarness} from './ui-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {nativePicker,openBrowser,defaultDataDirectory,showStartupError} from '../src/desktop.mjs';
import {spawnOwnedTool,stopProcessTree} from '../src/processes.mjs';
import {verifyRelease} from '../src/updates.mjs';
import {buildMac} from '../scripts/build-mac.mjs';
test('macOS keeps writable user data outside the application bundle',()=>{
 assert.equal(defaultDataDirectory('/Applications/GoStreams.app',{platform:'darwin',home:'/Users/Antonio'}),path.join('/Users/Antonio','Library','Application Support','Go Streams'));
 assert.equal(defaultDataDirectory('D:/App',{platform:'win32',home:'C:/Users/User'}),path.join('D:/App','data'));
});
test('macOS native picker parses Unicode and quoted paths, cancellation and malformed output',async()=>{
 const paths=['/Users/test/Vídeo de João.mp4','/Users/test/a"b.mov'];let call;
 assert.deepEqual(await nativePicker({platform:'darwin',execute:async(...args)=>{call=args;return{stdout:JSON.stringify(paths)};}}),paths);
 assert.equal(call[0],'/usr/bin/osascript');assert.deepEqual(call[1].slice(0,3),['-l','JavaScript','-e']);assert.match(call[1][3],/multipleSelectionsAllowed:true/);assert.match(call[1][3],/-128/);
 assert.deepEqual(await nativePicker({platform:'darwin',execute:async()=>({stdout:'[]'})}),[]);
 for(const stdout of ['null','{}','["relative.mp4"]','not json'])await assert.rejects(nativePicker({platform:'darwin',execute:async()=>({stdout})}));
});
test('macOS browser opens an app window or delegates one URL without shell interpolation',()=>{
 for(const browserPresent of [true,false]){
  let call;const url='http://127.0.0.1:4317/?launch='+'a'.repeat(64);openBrowser(url,{platform:'darwin',directory:'/Users/João/Library/Application Support/Go Streams',prepareProfile:()=>'/Users/João/Library/Application Support/Go Streams/desktop-browser',exists:()=>browserPresent,spawnProcess:(...args)=>{call=args;const child=new EventEmitter();child.unref=()=>{};return child;}});
  assert.equal(call[0],'/usr/bin/open');assert.equal(call[2].stdio,'ignore');assert.ok(!call[1].some(x=>x.includes('--no-sandbox')));
  if(browserPresent){assert.deepEqual(call[1].slice(0,4),['-n','-a','/Applications/Google Chrome.app','--args']);assert.ok(call[1].includes('--app='+url));assert.ok(!call[1].some(arg=>arg.startsWith('--user-data-dir=')));assert.ok(call[1].includes('--disable-features=Translate,msEdgeTranslate'));assert.ok(!call[1].includes('-g'));}
  else assert.deepEqual(call[1],[url]);
 }
});
test('POSIX group cancellation requires a child explicitly spawned as its own group',async()=>{
 let options,killed=0,group;
 const child={pid:12345,exitCode:null,kill(){killed++;}};
 spawnOwnedTool('yt-dlp',['--','https://www.youtube.com/watch?v=abcdefghijk'],{stdio:'pipe'},{platform:'darwin',spawnProcess:(command,args,settings)=>{options=settings;return child;}});
 assert.equal(options.detached,true);
 assert.equal(await stopProcessTree(child,{platform:'darwin',killGroup:(pid,signal)=>{group={pid,signal};}}),true);
 assert.deepEqual(group,{pid:-12345,signal:'SIGKILL'});assert.equal(killed,0);
 assert.equal(await stopProcessTree({pid:34567,exitCode:null,kill(){killed++;}},{platform:'darwin',killGroup:()=>assert.fail('unowned group')}),false);assert.equal(killed,1);
});
test('macOS accepts only updates signed for its own platform',()=>{
 const keys=crypto.generateKeyPairSync('ed25519');
 function manifest(platform){const payload=Buffer.from(JSON.stringify({product:'go-streams',platform,version:'9.0.0',url:'https://updates.example.test/mac.zip',sha256:'a'.repeat(64),bytes:100}));return{payload:payload.toString('base64'),signature:crypto.sign(null,payload,keys.privateKey).toString('base64')};}
 assert.equal(verifyRelease(manifest('darwin'),keys.publicKey.export({format:'pem',type:'spki'}),'0.8.0','darwin').available,true);
 assert.throws(()=>verifyRelease(manifest('win32'),keys.publicKey.export({format:'pem',type:'spki'}),'0.8.0','darwin'));
 assert.throws(()=>verifyRelease(manifest('darwin'),keys.publicKey.export({format:'pem',type:'spki'}),'0.8.0','win32'));
});
test('Mac bundle builder copies only runtime files and emits a relocatable launcher',()=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'mac-builder-'));
 try{
  for(const dir of ['src','public','data'])fs.mkdirSync(path.join(root,dir));fs.writeFileSync(path.join(root,'src','server.mjs'),'// fixture');fs.writeFileSync(path.join(root,'public','index.html'),'<html>test</html>');fs.copyFileSync(new URL('../public/icon.icns',import.meta.url),path.join(root,'public','icon.icns'));fs.writeFileSync(path.join(root,'data','secret'),'DO NOT COPY');
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'0.9.0'}));fs.writeFileSync(path.join(root,'README.md'),'Read me');
  vendorFixture(root,{macBinary:true});runtimeFixture(root);
  const native=universalFixture(),launcherDir=path.join(root,'vendor','mac-launcher');fs.mkdirSync(launcherDir,{recursive:true});fs.writeFileSync(path.join(launcherDir,'GoStreams'),native);for(const name of ['LICENSE','PATENTS'])fs.writeFileSync(path.join(launcherDir,name),'Go fixture '+name);fs.writeFileSync(path.join(launcherDir,'manifest.json'),JSON.stringify({bytes:native.length,sha256:crypto.createHash('sha256').update(native).digest('hex')}));
  const bundle=buildMac(root),launcher=fs.readFileSync(path.join(bundle,'Contents','MacOS','GoStreams'));
  assert.deepEqual(launcher,native);assert.deepEqual(inspectMachO(launcher).map(s=>s.arch),['x64','arm64']);
  assert.deepEqual(fs.readFileSync(path.join(bundle,'Contents','Resources','GoStreams.icns')),fs.readFileSync(new URL('../public/icon.icns',import.meta.url)));
  assert.match(fs.readFileSync(path.join(bundle,'Contents','Info.plist'),'utf8'),/CFBundleIconFile<\/key><string>GoStreams.icns/);
  assert.ok(fs.existsSync(path.join(bundle,'Contents','Resources','app','src','server.mjs')));assert.ok(!fs.existsSync(path.join(bundle,'Contents','Resources','app','data')));
  assert.ok(fs.existsSync(path.join(bundle,'Contents','Resources','app','vendor','yt-dlp','darwin','yt-dlp')));
  assert.equal(fs.existsSync(path.join(bundle,'Contents','Resources','app','vendor','yt-dlp','win32')),false);
  assert.match(fs.readFileSync(path.join(bundle,'Contents','Info.plist'),'utf8'),/LSMinimumSystemVersion<\/key><string>13\.5\.0<\/string>/);
 }finally{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('mac-builder-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});}
});

test('navigation collapse button changes accessible state without removing routes',()=>{
 const h=uiHarness(),toggle=h.element('#sidebar-toggle');
 assert.equal(toggle['aria-expanded'],'true');toggle.onclick();assert.equal(toggle['aria-expanded'],'false');assert.equal(toggle['aria-label'],'Expandir menu');assert.equal(h.element('html').dataset.compactNav,'true');
 h.run('draw()');assert.ok(h.element('#nav').innerHTML.includes('Agendamento'));assert.ok(h.element('#nav').innerHTML.includes('Ajuda'));
 toggle.onclick();assert.equal(toggle['aria-expanded'],'true');assert.equal(h.element('html').dataset.compactNav,'false');
});

test('macOS startup errors pass text as an argument instead of executable script',async()=>{
 let call;const message='A path with "quotes" and $(text)';await showStartupError(message,{platform:'darwin',execute:async(...args)=>{call=args;}});
 assert.equal(call[0],'/usr/bin/osascript');assert.equal(call[1].at(-1),message);assert.ok(!call[1][3].includes(message));
});

test('Windows built-in utilities use absolute system paths for picker, browser fallback and process cleanup',async()=>{
 assert.equal(windowsTool('powershell',{systemRoot:'D:\\Windows'}),'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.throws(()=>windowsTool('unknown'));assert.throws(()=>windowsTool('taskkill',{systemRoot:'relative'}));
 let command;
 assert.deepEqual(await nativePicker({platform:'win32',execute:async(file)=>{command=file;return {stdout:'[]'};}}),[]);
 assert.equal(command,windowsTool('powershell'));
 openBrowser('http://127.0.0.1:4317/',{platform:'win32',exists:()=>false,spawnProcess:file=>{command=file;const child=new EventEmitter();child.unref=()=>{};return child;}});
 assert.equal(command,windowsTool('browser'));
});

test('local import presents native Windows and Mac path examples without altering file references',async()=>{
 for(const platform of ['win32','darwin']){
  const h=uiHarness();h.run('health={platform:'+JSON.stringify(platform)+'}');await h.click('import');
  const html=h.element('#dialog-content').innerHTML;
  assert.ok(html.includes(platform==='darwin'?'/Users/name/Movies/video.mp4':'D:\\Vídeos\\concerto.mp4'));
  assert.ok(html.includes('data-action="import-link"'));assert.equal(h.requests.length,0);
 }
});
