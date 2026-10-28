import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {defaultDataDirectory} from '../src/desktop.mjs';

test('installed Windows data stays outside application files across versions',()=>{
 const local='C:/Users/Antonio/AppData/Local';
 for(const root of ['D:/Programs/Go Streams','D:/Programs/Go Streams 0.16.1'])
  assert.equal(defaultDataDirectory(root,{platform:'win32',installed:true,localData:local}),path.join(local,'Go Streams','data'));
 assert.equal(defaultDataDirectory('D:/Portable',{platform:'win32',installed:false,localData:local}),path.join('D:/Portable','data'));
});

test('Windows installer migration preserves projects, credentials and browser sessions through repeated upgrades',{skip:process.platform!=='win32',timeout:45000},t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'installed-data-regression-'));
 t.after(()=>{assert.ok(root.startsWith(parent+path.sep));assert.ok(path.basename(root).startsWith('installed-data-regression-'));fs.rmSync(root,{recursive:true,force:true});});
 const exe=path.join(root,'InstalledDataRegression.exe');
 const csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const built=spawnSync(csc,['/nologo','/target:exe','/main:InstalledDataRegression','/reference:System.Windows.Forms.dll','/out:'+exe,path.resolve('scripts/Launcher.cs'),path.resolve('test/InstalledDataRegression.cs')],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(built.status,0,built.error?.message||built.stdout||built.stderr);
 const checked=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(checked.status,0,checked.error?.message||checked.stdout||checked.stderr);
 assert.match(checked.stdout,/PASS:/);
});
