"""Build an offline Electron + NSIS Windows installer from verified local inputs."""
from pathlib import Path
import argparse, hashlib, importlib.util, json, os, shutil, subprocess, uuid
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
def digest(file):
    with Path(file).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def run(args):
    result=subprocess.run([str(a) for a in args],capture_output=True,text=True,encoding='utf-8',errors='replace',creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:raise RuntimeError(result.stdout+'\n'+result.stderr)
    return result.stdout
def nsis_escape(text):return str(text).replace('$','$$').replace('"','$\\"')
def owned_include(application,destination):
    lines=[]
    for file in sorted(application.rglob('*')):
        if file.is_symlink():raise ValueError('Unexpected symlink in application')
        if file.is_file() and file.name!='.gostreams-electron-install':lines.append('Delete "$INSTDIR\\'+nsis_escape(file.relative_to(application))+'"')
    for folder in sorted([p for p in application.rglob('*') if p.is_dir()],key=lambda p:len(p.parts),reverse=True):lines.append('RMDir "$INSTDIR\\'+nsis_escape(folder.relative_to(application))+'"')
    destination.write_text('\n'.join(lines)+'\n',encoding='utf-8')
def compile_installer(application,output,work,nsis,version,*,test_root=None):
    include=work/'owned-files.nsh';owned_include(application,include)
    definitions={'PRODUCT_VERSION':version,'OUTPUT_FILE':output,'APP_ICON':ROOT/'public/icon.ico','APPLICATION_DIR':application,'OWNED_FILES_INCLUDE':include}
    if test_root:
        ident=hashlib.sha256(str(test_root).encode()).hexdigest()[:16]
        definitions.update(TEST_ROOT=test_root,INSTALL_KEY=r'Software\Antonio Fradique\Go Streams\ElectronTest'+'\\'+ident,UNINSTALL_KEY=r'Software\Microsoft\Windows\CurrentVersion\Uninstall\GoStreams.ElectronTest.'+ident)
    args=[nsis,'/V2',*['/D'+k+'='+str(v) for k,v in definitions.items()],ROOT/'scripts/electron-installer.nsi']
    output_text=run(args)
    return output_text

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--electron-zip',type=Path,required=True)
    source=parser.add_mutually_exclusive_group(required=True);source.add_argument('--portable',type=Path);source.add_argument('--application-root',type=Path)
    parser.add_argument('--nsis',type=Path,required=True);parser.add_argument('--rcedit',type=Path,required=True);parser.add_argument('--replace',action='store_true')
    args=parser.parse_args();toolchain=json.loads((ROOT/'electron/toolchain.json').read_text('utf-8'));version=json.loads((ROOT/'package.json').read_text('utf-8'))['version']
    if digest(args.electron_zip)!=toolchain['sha256']:raise ValueError('Electron archive differs from the official SHA-256 digest')
    work=ROOT/'.tmp'/('electron-build-'+version+'-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
    stage=work/'GoStreams';stage.mkdir()
    with ZipFile(args.electron_zip) as archive:
        for entry in archive.infolist():
            file=(stage/entry.filename).resolve()
            if not file.is_relative_to(stage.resolve()) or '\\' in entry.filename:raise ValueError('Unsafe Electron archive path')
        archive.extractall(stage)
    (stage/'electron.exe').rename(stage/'GoStreams.exe')
    default=stage/'resources/default_app.asar'
    if default.exists():default.unlink()
    spec=importlib.util.spec_from_file_location('windows_builder',ROOT/'scripts/build-windows-installer.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    runtime_work=work/'runtime-inputs';runtime_work.mkdir()
    prepared=builder.prepare_application(runtime_work,portable=args.portable,application_root=args.application_root)
    application=stage/'resources/app';application.mkdir(parents=True)
    for folder in ['src','public','electron','runtime','vendor']:
        source=ROOT/folder if folder in ['src','public','electron'] else prepared/folder
        shutil.copytree(source,application/folder)
    # Electron already contains Node; the end-user package needs no second node.exe.
    (application/'runtime/win32-x64/node.exe').unlink()
    runtime_manifest=application/'runtime/win32-x64/manifest.json'
    runtime=json.loads(runtime_manifest.read_text('utf-8'));runtime['files']=[entry for entry in runtime['files'] if entry['name']!='node.exe'];runtime['nodeRuntime']='Electron '+toolchain['electronVersion'];runtime_manifest.write_text(json.dumps(runtime,indent=2)+'\n','utf-8')
    for name in ['package.json','README.md']:shutil.copy2(ROOT/name,application/name)
    (application/'.installed').write_text('go-streams-installed-v1\n','ascii')
    (stage/'.gostreams-electron-install').write_bytes(b'net.antoniofradique.gostreams\r\n')
    run([args.rcedit,stage/'GoStreams.exe','--set-icon',ROOT/'public/icon.ico','--set-version-string','ProductName','Go Streams','--set-version-string','FileDescription','Go Streams','--set-version-string','CompanyName','Antonio Fradique','--set-file-version',version+'.0','--set-product-version',version+'.0'])
    # Runtime package integrity is retained in the build report; no state is shipped.
    files=[]
    for file in sorted(stage.rglob('*')):
        if not file.is_file():continue
        relative=file.relative_to(stage).as_posix()
        if any(p in ('data','electron-session','desktop-browser','.tmp','node_modules') for p in file.relative_to(stage).parts):raise ValueError('Private state in application package')
        files.append({'path':relative,'bytes':file.stat().st_size,'sha256':digest(file)})
    output=ROOT/'release'/('GoStreams-'+version+'-Electron-Setup.exe')
    if output.exists() and not args.replace:raise FileExistsError('Existing installer preserved; pass --replace to rebuild')
    candidate=work/output.name
    print(json.dumps({'phase':'compressing','electron':toolchain['electronVersion'],'files':len(files),'application':str(stage)}),flush=True)
    log=compile_installer(stage,candidate,work,args.nsis,version);(work/'nsis-build.log').write_text(log,encoding='utf-8')
    os.replace(candidate,output)
    report={'version':version,'electronVersion':toolchain['electronVersion'],'electronArchiveSHA256':toolchain['sha256'],'installer':str(output),'installerSHA256':digest(output),'installerBytes':output.stat().st_size,'application':str(stage),'work':str(work),'files':files,'dataPath':'%LOCALAPPDATA%\\Go Streams\\data','electronSessionPath':'%LOCALAPPDATA%\\Go Streams\\data\\electron-session','appId':toolchain['appId'],'userDataIncluded':False,'codeSigned':False,'nativeInstallationTested':False,'nsisSHA256':digest(args.nsis),'rceditSHA256':digest(args.rcedit)}
    (ROOT/'release'/('GoStreams-'+version+'-Electron-build.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['installer','installerBytes','installerSHA256','application']}),flush=True)

if __name__=='__main__':main()
