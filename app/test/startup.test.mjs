import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {createApplication} from '../src/server.mjs';
import {openBrowser,prepareBrowserProfile} from '../src/desktop.mjs';
import {dispatch} from './transport.mjs';

test('cold-start readiness is authenticated and independent of tool checks',async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'startup-ready-'));
 const app=await createApplication({directory,listen:false,clock:false,portableVault:true});
 t.after(async()=>{await app.close();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 assert.equal((await dispatch(app,'/api/ready')).status,401);
 const headers={Cookie:'go_streams='+app.token};
 const response=await dispatch(app,'/api/ready',{headers});
 assert.equal(response.status,200);assert.equal(response.headers.get('x-go-streams-ready'),'1');
 assert.deepEqual(await response.json(),{ready:true});
 assert.equal((await dispatch(app,'/api/ready',{headers:{...headers,Origin:'https://foreign.example'}})).status,403);
 const page=await dispatch(app,'/',{headers});const html=await page.text();assert.match(html,/id="startup-status"/);assert.match(html,/<html[^>]+translate="no"/);assert.match(html,/class="notranslate"/);assert.match(html,/id="language-select"/);
 assert.equal((await dispatch(app,'/boot.js',{headers})).status,200);
 const favicon=await dispatch(app,'/icon.ico?v=0.15.5',{headers});
 assert.equal(favicon.status,200);assert.equal(favicon.headers.get('content-type'),'image/vnd.microsoft.icon');
 assert.deepEqual(favicon.body,fs.readFileSync(new URL('../public/icon.ico',import.meta.url)));
 const brand=await dispatch(app,'/icon.webp',{headers});assert.equal(brand.status,200);
 assert.deepEqual(brand.body,fs.readFileSync(new URL('../public/icon.webp',import.meta.url)));

});

test('Windows app windows use a dedicated visible profile and retain the browser sandbox',()=>{
 let call;
 openBrowser('http://127.0.0.1:4317/',{platform:'win32',directory:'D:/Go Streams/data',prepareProfile:dir=>path.join(dir,'desktop-browser'),exists:()=>true,spawnProcess:(...args)=>{call=args;const p=new EventEmitter();p.unref=()=>{};return p;}});
 assert.ok(call[1].includes('--user-data-dir='+path.join('D:/Go Streams/data','desktop-browser')));
 assert.ok(call[1].includes('--no-first-run'));
 for(const flag of ['--profile-directory=Default','--hide-crash-restore-bubble','--disable-sync','--disable-features=msImplicitSignin,Translate,msEdgeTranslate','--edge-skip-compat-layer-relaunch'])assert.ok(call[1].includes(flag),flag);assert.equal(call[2].windowsHide,false);
 assert.ok(!call[1].includes('--no-sandbox'));
});

function boot(){
 const handlers={},timer=[],messages={textContent:''},retry={hidden:true,addEventListener:(name,fn)=>handlers.retry=fn},panel={isConnected:true};
 let reloads=0,cancelled=0;
 const document={getElementById:id=>({'startup-status':panel,'startup-message':messages,'startup-retry':retry})[id],addEventListener:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(fs.readFileSync(new URL('../public/boot.js',import.meta.url),'utf8'),{document,window:{addEventListener:(name,fn)=>handlers[name]=fn},location:{reload:()=>reloads++},setTimeout:fn=>{timer.push(fn);return 1;},clearTimeout:()=>cancelled++});
 return{handlers,timer,messages,retry,panel,reloads:()=>reloads,cancelled:()=>cancelled};
}
test('a failed first module load exposes an immediate retry without a blank view',()=>{
 const b=boot();b.handlers.error();
 assert.equal(b.retry.hidden,false);assert.match(b.messages.textContent,/do not need to restart/);
 b.handlers.retry();assert.equal(b.reloads(),1);
});
test('a slow first load recovers visibly and successful startup cancels the fallback',()=>{
 const b=boot();b.timer[0]();assert.equal(b.retry.hidden,false);
 const ready=boot();ready.handlers['go-streams-ready']();assert.equal(ready.cancelled(),1);
 ready.handlers.error();ready.timer[0]();assert.equal(ready.retry.hidden,true);
});

test('native Windows readiness and argument quoting regressions',{skip:process.platform!=='win32',timeout:30000},t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'launcher-regression-'));
 t.after(()=>{assert.ok(dir.startsWith(parent+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const exe=path.join(dir,'LauncherRegression.exe');
 const csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const build=spawnSync(csc,['/nologo','/target:exe','/main:LauncherRegression','/reference:System.Windows.Forms.dll','/out:'+exe,path.resolve('scripts/Launcher.cs'),path.resolve('test/LauncherRegression.cs')],{encoding:'utf8',windowsHide:true});
 assert.equal(build.status,0,build.error?.message||build.stdout||build.stderr);
 const run=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(run.status,0,run.error?.message||run.stdout||run.stderr);assert.match(run.stdout,/PASS:/);
});

test('first app profile is initialised once without resetting settings or a neighbouring browser profile',t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'app-browser-profile-'));
 t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const directory=path.join(root,'app-data'),other=path.join(root,'other-browser');
 fs.mkdirSync(other);fs.writeFileSync(path.join(other,'Preferences'),'other browser settings');
 const profile=prepareBrowserProfile(directory);
 assert.equal(profile,path.join(directory,'desktop-browser'));
 assert.equal(fs.readFileSync(path.join(profile,'First Run'),'utf8'),'');
 fs.mkdirSync(path.join(profile,'Default'));
 fs.writeFileSync(path.join(profile,'Default','Preferences'),'existing application preferences');
 fs.writeFileSync(path.join(profile,'First Run'),'existing marker');
 assert.equal(prepareBrowserProfile(directory),profile);
 assert.equal(fs.readFileSync(path.join(profile,'First Run'),'utf8'),'existing marker');
 assert.equal(fs.readFileSync(path.join(profile,'Default','Preferences'),'utf8'),'existing application preferences');
 assert.equal(fs.readFileSync(path.join(other,'Preferences'),'utf8'),'other browser settings');
});
