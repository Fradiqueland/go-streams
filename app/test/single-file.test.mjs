import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('Windows single EXE cache verifies extraction, reuse, corruption, ZIP safety and data persistence',{skip:process.platform!=='win32',timeout:45000},t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'single-file-regression-'));
 t.after(()=>{assert.ok(root.startsWith(parent+path.sep));assert.ok(path.basename(root).startsWith('single-file-regression-'));fs.rmSync(root,{recursive:true,force:true});});
 const output=path.join(root,'SingleFileRegression.exe');
 const csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const built=spawnSync(csc,['/nologo','/target:exe','/main:SingleFileRegression','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.Xml.dll','/out:'+output,path.resolve('scripts/Launcher.cs'),path.resolve('scripts/SingleFile.cs'),path.resolve('test/SingleFileRegression.cs')],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(built.status,0,built.error?.message||built.stdout||built.stderr);
 const check=spawnSync(output,[],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(check.status,0,check.error?.message||check.stdout||check.stderr);
 assert.match(check.stdout,/PASS:/);
});
