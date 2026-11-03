import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import dataPolicy from '../electron/data-policy.cjs';

function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'streamland-upgrade-'));
 t.after(()=>{assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('streamland-upgrade-'));fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
function write(root,name,contents){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);}

test('Streamland opens the established Electron project and session without rewriting either',t=>{
 const root=fixture(t),local=path.join(root,'local'),previous=path.join(local,'Go Streams');
 const files={'data/project.json':'saved channels and playlists','data/vault.dpapi':'protected credentials','data/electron-session/Network/Cookies':'existing signed-in cookies','data/electron-session/Local Storage/leveldb/000001.log':'saved preferences','electron-host/Local State':'existing encryption state'};
 for(const [name,contents]of Object.entries(files))write(previous,name,contents);
 const paths=dataPolicy.userPaths(local);
 assert.equal(paths.state,previous);assert.equal(paths.host,path.join(previous,'electron-host'));
 const portable=path.join(root,'Streamland-data');write(portable,'project.json','a different project');
 assert.equal(dataPolicy.migrateData(paths.data,portable).migrated,false);
 assert.equal(dataPolicy.migratePreferences(paths.data),path.join(previous,'data','electron-session'));
 for(const [name,contents]of Object.entries(files))assert.equal(fs.readFileSync(path.join(previous,name),'utf8'),contents);
 assert.equal(fs.existsSync(path.join(local,'Streamland')),false);
});

test('portable data discovery accepts both brands and rejects conflicting projects',t=>{
 const root=fixture(t);
 for(const [index,name]of ['Streamland-data','GoStreams-data','Streamland/data','GoStreams/data','Streamland-1.2.0/data','GoStreams-1.1.6/data'].entries()){
  const outer=path.join(root,'case-'+index),data=path.join(outer,name);
  write(data,'project.json',name);assert.equal(dataPolicy.discoverLegacy(outer),data);
 }
 const mixed=path.join(root,'mixed');write(mixed,'Streamland-data/project.json','new');write(mixed,'GoStreams-data/project.json','old');
 assert.throws(()=>dataPolicy.discoverLegacy(mixed),/More than one portable data folder/);
 assert.equal(fs.readFileSync(path.join(mixed,'GoStreams-data/project.json'),'utf8'),'old');
});

test('compiled Windows launchers reuse old portable projects after the Streamland rename',{skip:process.platform!=='win32',timeout:45000},t=>{
 const root=fixture(t),source=path.join(root,'RenameRegression.cs'),exe=path.join(root,'RenameRegression.exe');
 fs.writeFileSync(source,String.raw`using System;using System.IO;
class RenameRegression {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static string Project(string root,string folder){string data=Path.Combine(root,folder,"data");Directory.CreateDirectory(data);File.WriteAllText(Path.Combine(data,"project.json"),folder);return data;}
 static int Main(string[] args){
  string root=args[0],oldOverride=Environment.GetEnvironmentVariable("GO_STREAMS_DATA");Environment.SetEnvironmentVariable("GO_STREAMS_DATA",null);
  try {
   string portable=Path.Combine(root,"portable"),local=Path.Combine(root,"local");Directory.CreateDirectory(portable);
   string legacy=Project(portable,"GoStreams-1.1.6"),current=Path.Combine(portable,"Streamland-1.2.0");Directory.CreateDirectory(current);
   Check(Launcher.DataDirectory(current)==legacy,"Streamland portable lost the preceding Go Streams project");
   Check(GoStreamsSingleFile.DataDirectory(portable,local)==legacy,"Single file lost the preceding Go Streams project");
   string renamed=Project(portable,"Streamland-1.1.7");
   Check(Launcher.DataDirectory(current)==renamed,"Portable did not select the latest project across both brands");
   Check(GoStreamsSingleFile.DataDirectory(portable,local)==renamed,"Single file did not select the latest project across both brands");
   foreach(string brand in new[]{"Streamland-data","GoStreams-data","Streamland","GoStreams"}){
    string outer=Path.Combine(root,"discovery-"+brand);Directory.CreateDirectory(outer);
    string data=brand.EndsWith("-data")?Path.Combine(outer,brand):Path.Combine(outer,brand,"data");Directory.CreateDirectory(data);File.WriteAllText(Path.Combine(data,"project.json"),brand);
    Check(Launcher.FindPortableData(outer)==data,"Installed launcher failed to discover "+brand);
    Check(GoStreamsSingleFile.DataDirectory(outer,local)==data,"Single file failed to discover "+brand);
   }
   string installed=Project(local,"Go Streams");File.WriteAllText(Path.Combine(installed,"vault.dpapi"),"saved credentials");
   Check(Launcher.InstalledDataDirectory(local,renamed)==installed,"Installed upgrade changed the private data path");
   Check(File.ReadAllText(Path.Combine(installed,"vault.dpapi"))=="saved credentials","Installed credentials changed");
   Check(File.ReadAllText(Path.Combine(legacy,"project.json"))=="GoStreams-1.1.6","Portable original changed");
   Console.WriteLine("PASS: Streamland portable, single-file and installed data continuity");return 0;
  }finally{Environment.SetEnvironmentVariable("GO_STREAMS_DATA",oldOverride);}
 }
}`);
 const csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const built=spawnSync(csc,['/nologo','/target:exe','/main:RenameRegression','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.Xml.dll','/out:'+exe,path.resolve('scripts/Launcher.cs'),path.resolve('scripts/SingleFile.cs'),source],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(built.status,0,built.error?.message||built.stdout||built.stderr);
 const checked=spawnSync(exe,[path.join(root,'fixtures')],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(checked.status,0,checked.error?.message||checked.stdout||checked.stderr);assert.match(checked.stdout,/PASS:/);
});
