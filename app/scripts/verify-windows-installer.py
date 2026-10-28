"""Validate an MSI and exercise install/rollback/upgrade/uninstall on an isolated fixture."""
from pathlib import Path
import argparse, ctypes, gc, hashlib, importlib.util, json, os, shutil, subprocess, uuid

ROOT=Path(__file__).resolve().parents[1]

def rows(db,table):
    view=db.OpenView('SELECT * FROM `'+table+'`');view.Execute(None);result=[]
    while True:
        record=view.Fetch()
        if record is None:break
        result.append(tuple(record.GetString(i) for i in range(1,record.GetFieldCount()+1)))
    view.Close();return result

def validate(package):
    import msilib
    db=msilib.OpenDatabase(str(package),msilib.MSIDBOPEN_READONLY)
    properties=dict(rows(db,'Property'));directories={row[0]:row for row in rows(db,'Directory')}
    files=rows(db,'File');components={row[0]:row for row in rows(db,'Component')}
    registry={row[0]:row for row in rows(db,'Registry')}
    for component in components.values():
        assert int(component[3])&4, 'User profile component must have an HKCU key path'
        key=registry[component[5]]
        assert key[1]=='1' and key[5]==component[0], 'Incorrect per-user component registration'
    shortcuts=rows(db,'Shortcut');upgrades=rows(db,'Upgrade');sequence={row[0]:int(row[2]) for row in rows(db,'InstallExecuteSequence')}
    assert not properties.get('ALLUSERS'), 'Installer must be per-user'
    assert directories['INSTALLDIR'][1]=='ProgramsDir' and directories['ProgramsDir'][1]=='LocalAppDataFolder'
    paths={}
    def folder(key):
        if key=='INSTALLDIR':return ''
        entry=directories[key];return folder(entry[1])+entry[2].split('|')[-1]+'/'
    for file in files:
        component=components[file[1]];relative=folder(component[2])+file[2].split('|')[-1];paths[relative]=file[0]
        assert not any(p.casefold() in ('data','.tmp','desktop-browser') for p in relative.split('/'))
    for required in ['GoStreams.exe','.installed','src/server.mjs','src/version.mjs','public/index.html','public/style.css','runtime/win32-x64/node.exe','runtime/win32-x64/ffmpeg.exe','runtime/win32-x64/ffprobe.exe','vendor/yt-dlp/win32/yt-dlp.exe']:
        assert required in paths, 'Missing installer component: '+required
    assert {row[1] for row in shortcuts}=={'DesktopFolder','GoStreamsMenu'}
    assert all(row[4]=='[#'+paths['GoStreams.exe']+']' for row in shortcuts)
    assert all(row[0]==properties['UpgradeCode'] for row in upgrades)
    assert sequence['InstallInitialize']<sequence['RemoveExistingProducts']<sequence['ProcessComponents']
    assert not rows(db,'CustomAction'), 'Shipping package must not execute custom installer scripts'
    assert not rows(db,'RemoveRegistry'), 'Shipping package must not remove existing user registry trees'
    summary=db.GetSummaryInformation(0)
    assert summary.GetProperty(msilib.PID_WORDCOUNT)&8, 'Package unexpectedly requests elevation'
    template=summary.GetProperty(msilib.PID_TEMPLATE)
    if isinstance(template,bytes):template=template.decode('ascii')
    assert template.startswith('x64;')
    return {'package':str(package),'files':len(files),'shortcuts':len(shortcuts),'perUser':True,'dataExcluded':True,'transactionalUpgrade':True,'version':properties['ProductVersion']}

def extract_payload(package,work):
    import msilib
    build_path=package.with_name(package.stem+'-build.json')
    build=json.loads(build_path.read_text('utf-8'))
    cabinet=work/'application.cab'
    msi=ctypes.WinDLL('msi');handle=ctypes.c_uint();view=ctypes.c_uint();record=ctypes.c_uint()
    msi.MsiOpenDatabaseW.argtypes=[ctypes.c_wchar_p,ctypes.c_void_p,ctypes.POINTER(ctypes.c_uint)]
    msi.MsiDatabaseOpenViewW.argtypes=[ctypes.c_uint,ctypes.c_wchar_p,ctypes.POINTER(ctypes.c_uint)]
    msi.MsiViewFetch.argtypes=[ctypes.c_uint,ctypes.POINTER(ctypes.c_uint)]
    msi.MsiRecordReadStream.argtypes=[ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p,ctypes.POINTER(ctypes.c_uint)]
    try:
        assert msi.MsiOpenDatabaseW(str(package),None,ctypes.byref(handle))==0
        assert msi.MsiDatabaseOpenViewW(handle,"SELECT `Data` FROM `_Streams` WHERE `Name`='ApplicationCab'",ctypes.byref(view))==0
        assert msi.MsiViewExecute(view,0)==0 and msi.MsiViewFetch(view,ctypes.byref(record))==0
        buffer=ctypes.create_string_buffer(1024*1024);total=0
        with cabinet.open('wb') as output:
            while True:
                count=ctypes.c_uint(len(buffer));assert msi.MsiRecordReadStream(record,1,buffer,ctypes.byref(count))==0
                if not count.value:break
                total+=count.value;assert total<1024*1024*1024
                output.write(buffer.raw[:count.value])
    finally:
        for resource in [record,view,handle]:
            if resource.value:msi.MsiCloseHandle(resource)
    with cabinet.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==build['cabinetSHA256'], 'Embedded CAB differs from verified build input'
    flat=work/'cabinet-files';flat.mkdir()
    # Only expand the CAB whose exact hash was retained by the trusted build.
    result=subprocess.run([str(Path(os.environ.get('WINDIR',r'C:\Windows'))/'System32/expand.exe'),'-F:*',str(cabinet),str(flat)],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW,timeout=180)
    assert result.returncode==0, result.stderr.decode(errors='replace')
    expected={item['id']:item for item in build['files']}
    assert {f.name for f in flat.iterdir()}==set(expected)
    application=work/'application';application.mkdir()
    for key,item in expected.items():
        source=flat/key;assert source.is_file() and not source.is_symlink()
        assert source.stat().st_size==item['bytes']
        with source.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==item['sha256']
        target=(application/item['path']).resolve();assert target.is_relative_to(application.resolve())
        target.parent.mkdir(parents=True,exist_ok=True);source.rename(target)
    for folder in ['src','public']:
        for file in (ROOT/folder).rglob('*'):
            if file.is_file():assert (application/file.relative_to(ROOT)).read_bytes()==file.read_bytes(), 'Stale installed source: '+str(file)
    for file in ['package.json','README.md']:assert (application/file).read_bytes()==(ROOT/file).read_bytes()
    return {'embeddedCabinetVerified':True,'allFileHashesMatch':True,'sourceParity':True,'applicationDirectory':str(application)}

def native_fixture(work):
    import msilib
    module=importlib.util.spec_from_file_location('installer_builder',ROOT/'scripts/build-windows-installer.py');builder=importlib.util.module_from_spec(module);module.loader.exec_module(builder)
    test_id=uuid.uuid4().hex;source=work/'fixture-source';source.mkdir()
    install=work/'Installed';desktop=work/'Desktop';menu=work/'StartMenu';data=work/'LocalUserData'/'Go Streams'/'data'
    for folder in [desktop,menu,data]:folder.mkdir(parents=True)
    (source/'public').mkdir();shutil.copy2(ROOT/'public/icon.ico',source/'public/icon.ico')
    # A fixture is sufficient to exercise Windows Installer's real transaction engine.
    (source/'GoStreams.exe').write_bytes(b'fixture launcher; not executed')
    (source/'.installed').write_text('go-streams-installed-v1\n')
    (source/'revision.txt').write_text('baseline')
    one=work/'baseline.msi';baseline=builder.build_msi(source,one,'0.16.0',test_identity=test_id)
    (source/'revision.txt').write_text('updated')
    two=work/'upgrade.msi';upgraded=builder.build_msi(source,two,'0.16.1',test_identity=test_id)
    # Redirect shell folders inside the fixture BEFORE any native install. Private
    # Windows Installer folder properties cannot safely be set on its command line.
    for package in [one,two]:
        db=msilib.OpenDatabase(str(package),msilib.MSIDBOPEN_TRANSACT)
        msilib.add_data(db,'CustomAction',[
            ('FixtureDesktop',51,'DesktopFolder',str(desktop)+os.sep),
            ('FixtureStartMenu',51,'ProgramMenuFolder',str(menu)+os.sep)
        ])
        actions=[('FixtureDesktop',None,801),('FixtureStartMenu',None,802)]
        msilib.add_data(db,'InstallExecuteSequence',actions);msilib.add_data(db,'InstallUISequence',actions)
        db.Commit();db=None;gc.collect()
    failing=work/'rollback.msi';shutil.copy2(two,failing)
    db=msilib.OpenDatabase(str(failing),msilib.MSIDBOPEN_TRANSACT)
    msilib.add_data(db,'CustomAction',[('VerificationFailure',19,None,'Controlled rollback verification')])
    msilib.add_data(db,'InstallExecuteSequence',[('VerificationFailure','OLDPRODUCTS',4100)])
    db.Commit();db=None;gc.collect()
    for relative,value in [('project.json',b'project'),('vault.dpapi',b'protected credentials'),('desktop-browser/Default/Network/Cookies',b'authenticated sessions'),('desktop-browser/Default/Preferences',b'profile preferences')]:
        file=data/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(value)
    def snapshot():return {str(f.relative_to(data)):hashlib.sha256(f.read_bytes()).hexdigest() for f in data.rglob('*') if f.is_file()}
    original=snapshot()
    msi=ctypes.WinDLL('msi');msi.MsiSetInternalUI.argtypes=[ctypes.c_uint,ctypes.c_void_p];msi.MsiSetInternalUI(2,None)
    msi.MsiInstallProductW.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p];msi.MsiInstallProductW.restype=ctypes.c_uint
    msi.MsiConfigureProductExW.argtypes=[ctypes.c_wchar_p,ctypes.c_int,ctypes.c_int,ctypes.c_wchar_p];msi.MsiConfigureProductExW.restype=ctypes.c_uint
    msi.MsiEnableLogW.argtypes=[ctypes.c_uint,ctypes.c_wchar_p,ctypes.c_uint]
    options='INSTALLDIR="'+str(install)+'" REBOOT=ReallySuppress'
    installed=[]
    def apply(file,name):
        msi.MsiEnableLogW(0x3fff,str(work/(name+'.log')),3)
        return int(msi.MsiInstallProductW(str(file),options))
    try:
        code=apply(one,'install')
        if code not in (0,3010):return {'nativeInstallTested':False,'installerResult':code,'log':str(work/'install.log')}
        installed.append(baseline['productCode'])
        assert (install/'revision.txt').read_text()=='baseline'
        assert (desktop/'Go Streams.lnk').is_file() and (menu/'Go Streams'/'Go Streams.lnk').is_file()
        assert snapshot()==original
        rejected=apply(failing,'rollback')
        assert rejected not in (0,3010), 'Controlled failed upgrade unexpectedly succeeded'
        assert (install/'revision.txt').read_text()=='baseline', 'Failed upgrade did not roll back application files'
        assert snapshot()==original, 'Rollback changed existing user data'
        code=apply(two,'upgrade');assert code in (0,3010), 'Upgrade failed: '+str(code)
        installed.append(upgraded['productCode'])
        assert (install/'revision.txt').read_text()=='updated'
        assert snapshot()==original
        assert (desktop/'Go Streams.lnk').is_file()
        uninstall=int(msi.MsiConfigureProductExW(upgraded['productCode'],0,2,'REMOVE=ALL REBOOT=ReallySuppress'))
        assert uninstall in (0,3010), 'Uninstall failed: '+str(uninstall)
        assert not (install/'revision.txt').exists() and not (desktop/'Go Streams.lnk').exists()
        assert snapshot()==original
        return {'nativeInstallTested':True,'shortcutsCreated':True,'failedUpgradeRolledBack':True,'upgradeCompleted':True,'uninstallPreservedData':True,'profileHashesUnchanged':True}
    finally:
        for product in reversed(installed):msi.MsiConfigureProductExW(product,0,2,'REMOVE=ALL REBOOT=ReallySuppress')
        msi.MsiEnableLogW(0,None,0)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('package',type=Path);parser.add_argument('--native',action='store_true');parser.add_argument('--payload',action='store_true');args=parser.parse_args()
    report=validate(args.package.resolve())
    if args.payload:
        work=ROOT/'.tmp'/('msi-payload-verification-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
        report['payload']=extract_payload(args.package.resolve(),work)
    if args.native:
        work=ROOT/'.tmp'/('msi-verification-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
        report['native']=native_fixture(work)
    destination=args.package.with_suffix('.verification.json');destination.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report),flush=True)

if __name__=='__main__':main()
