import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const python=process.env.PYTHON||'python';
const available=spawnSync(python,['--version'],{encoding:'utf8',windowsHide:true}).status===0;
const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
const exercise=String.raw`
import hashlib, importlib.util, json, sys, zipfile
from pathlib import Path
root=Path(sys.argv[1]);kind=sys.argv[2];script=Path(sys.argv[3])
def put(name,value):
    file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text(value,encoding='utf-8')
put('package.json',json.dumps({'version':'1.2.3'}));put('README.md','fixture');put('public/icon.ico','fixture');put('src/server.mjs','fixture')
spec=importlib.util.spec_from_file_location('fixture_builder',script);builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder);builder.ROOT=root
def prepare(work,*args,**options):
    application=work/'application';application.mkdir();return application
if kind=='msi':
    builder.prepare_application=prepare
    def compile(application,output,version):
        output.write_bytes(b'checked MSI fixture');return {'version':version}
    builder.build_msi=compile
    sys.argv=[str(script),'--application-root',str(root/'inputs')]
else:
    archive=root/'electron.zip'
    with zipfile.ZipFile(archive,'w') as package:
        package.writestr('electron.exe',b'fixture');package.writestr('resources/default_app.asar',b'fixture')
    put('electron/toolchain.json',json.dumps({'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'electronVersion':'44.0.0','appId':'fixture'}))
    put('scripts/build-windows-installer.py', '''import json
def prepare_application(work,**options):
    application=work/'application'
    runtime=application/'runtime/win32-x64';runtime.mkdir(parents=True)
    (runtime/'node.exe').write_bytes(b'fixture');(runtime/'manifest.json').write_text(json.dumps({'files':[{'name':'node.exe'}]}))
    (application/'vendor').mkdir()
    return application
''')
    builder.run=lambda args:''
    def compile(application,output,work,nsis,version):
        output.write_bytes(b'checked Electron fixture');return 'fixture compiler log'
    builder.compile_installer=compile
    sys.argv=[str(script),'--application-root',str(root/'inputs'),'--electron-zip',str(archive),'--nsis',str(root/'public/icon.ico'),'--rcedit',str(root/'public/icon.ico')]
assert not (root/'release').exists()
builder.main()
`;

for(const [kind,script,name,report] of [
 ['msi','build-windows-installer.py','GoStreams-1.2.3-Windows-Setup.msi','GoStreams-1.2.3-Windows-Setup-build.json'],
 ['electron','build-electron-windows.py','GoStreams-1.2.3-Electron-Setup.exe','GoStreams-1.2.3-Electron-build.json'],
])test(kind+' installer publishes successfully in a fresh checkout without a release folder',{skip:!available},t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'installer-publish-'));
 t.after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const result=spawnSync(python,['-c',exercise,root,kind,path.join(scripts,script)],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.ok(fs.statSync(path.join(root,'release',name)).size>0);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'release',report),'utf8')).version,'1.2.3');
});
