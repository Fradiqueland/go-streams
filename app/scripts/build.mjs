import {requireYtdlp,copyYtdlp} from './vendor-ytdlp.mjs';
import {requireRuntime,copyRuntime,runtimeTargets} from './vendor-runtime.mjs';
import {buildCatalogs} from './build-locales.mjs';
import {buildMac} from './build-mac.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const platform=process.argv.find(a=>a.startsWith('--platform='))?.slice(11)||process.platform;
if(!['all','win32','darwin'].includes(platform))throw Error('Unsupported build platform');
const platforms=platform==='all'?['win32','darwin']:[platform];
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid application version');
for(const p of platforms){requireYtdlp(root,p);for(const target of runtimeTargets(p))requireRuntime(root,target);}
buildCatalogs(root);
if(platforms.includes('win32')){
 if(process.platform!=='win32')throw Error('Build the Windows launcher on Windows');
 const release=path.join(root,'release','GoStreams-'+version),binary=path.join(release,'GoStreams.exe');
 if(fs.existsSync(binary)){let fd;try{fd=fs.openSync(binary,'r+');}catch{throw Error('Close this Go Streams version before rebuilding.');}finally{if(fd!==undefined)fs.closeSync(fd);}}
 fs.mkdirSync(release,{recursive:true});
 for(const folder of ['src','public'])fs.cpSync(path.join(root,folder),path.join(release,folder),{recursive:true});
 for(const name of ['package.json','README.md'])fs.copyFileSync(path.join(root,name),path.join(release,name));
 copyYtdlp(root,release,'win32');copyRuntime(root,release,'win32');
 const csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const result=spawnSync(csc,['/nologo','/target:winexe','/reference:System.Windows.Forms.dll','/win32icon:'+path.join(root,'public','icon.ico'),'/out:'+binary,path.join(root,'scripts','Launcher.cs')],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error(result.stdout||result.stderr||String(result.error));
 fs.writeFileSync(path.join(release,'CloseGoStreams.cmd'),'@echo off\r\n"%~dp0GoStreams.exe" --close\r\n');
 console.log('Windows build ready: '+release);
}
if(platforms.includes('darwin'))console.log('Mac bundle prepared (execution not validated): '+buildMac(root));
