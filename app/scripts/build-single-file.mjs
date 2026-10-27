import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32')throw Error('Build the single Windows EXE on Windows.');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid version');
const work=path.join(root,'.tmp','single-file-'+version);fs.mkdirSync(work,{recursive:true});
function run(command,args,timeout=300000){const r=spawnSync(command,args,{cwd:root,windowsHide:true,encoding:'utf8',timeout});if(r.status!==0)throw Error(r.error?.message||r.stdout||r.stderr||'Build failed');if(r.stdout)process.stdout.write(r.stdout);}
run(process.env.GO_STREAMS_PYTHON||'python',[path.join(root,'scripts','single-file-payload.py'),work]);
const output=path.join(root,'release','GoStreams-'+version+'-SingleFile.exe');
if(fs.existsSync(output)){const fd=fs.openSync(output,'r+');fs.closeSync(fd);}
const candidate=path.join(work,'GoStreams.exe');
const assembly=path.join(work,'Version.cs');
fs.writeFileSync(assembly,'using System.Reflection;\n[assembly: AssemblyTitle("Go Streams")]\n[assembly: AssemblyProduct("Go Streams")]\n[assembly: AssemblyCompany("Antonio Fradique")]\n[assembly: AssemblyVersion("'+version+'.0")]\n[assembly: AssemblyFileVersion("'+version+'.0")]\n');
const csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
run(csc,['/nologo','/target:winexe','/main:GoStreamsSingleFile','/optimize+','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.Xml.dll','/win32icon:'+path.join(root,'public','icon.ico'),'/resource:'+path.join(root,'public','icon.ico')+',GoStreams.Icon','/resource:'+path.join(work,'payload.zip')+',GoStreams.Payload','/resource:'+path.join(work,'manifest.xml')+',GoStreams.Manifest','/out:'+candidate,path.join(root,'scripts','Launcher.cs'),path.join(root,'scripts','SingleFile.cs'),assembly]);
fs.copyFileSync(candidate,output);
for(const file of [candidate,path.join(work,'payload.zip')]){try{fs.unlinkSync(file);}catch{}}
console.log(JSON.stringify({file:output,bytes:fs.statSync(output).size,version}));
