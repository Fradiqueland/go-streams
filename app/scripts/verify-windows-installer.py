"""Validate an MSI and exercise install/rollback/upgrade/uninstall on an isolated fixture."""
from pathlib import Path
import argparse, ctypes, gc, hashlib, importlib.util, json, os, shutil, subprocess, types, uuid

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
    assert properties['ProductName']=='Streamland', 'Installed product name differs from the current brand'
    assert not properties.get('ALLUSERS'), 'Installer must be per-user'
    assert directories['INSTALLDIR'][1]=='ProgramsDir' and directories['ProgramsDir'][1]=='LocalAppDataFolder'
    assert directories['INSTALLDIR'][2].split('|')[-1]=='Streamland'
    assert directories['GoStreamsMenu'][2].split('|')[-1]=='Streamland'
    paths={}
    def folder(key):
        if key=='INSTALLDIR':return ''
        entry=directories[key];return folder(entry[1])+entry[2].split('|')[-1]+'/'
    for file in files:
        component=components[file[1]];relative=folder(component[2])+file[2].split('|')[-1];paths[relative]=file[0]
        assert not any(p.casefold() in ('data','.tmp','desktop-browser') for p in relative.split('/'))
    for required in ['Streamland.exe','.installed','src/server.mjs','src/version.mjs','public/index.html','public/style.css','runtime/win32-x64/node.exe','runtime/win32-x64/ffmpeg.exe','runtime/win32-x64/ffprobe.exe','vendor/yt-dlp/win32/yt-dlp.exe']:
        assert required in paths, 'Missing installer component: '+required
    assert {row[1] for row in shortcuts}=={'DesktopFolder','GoStreamsMenu'}
    assert all(row[2].split('|')[-1]=='Streamland' for row in shortcuts)
    assert all(row[4]=='[#'+paths['Streamland.exe']+']' for row in shortcuts)
    assert all(row[8]=='Streamland.exe' for row in shortcuts) and properties['ARPPRODUCTICON']=='Streamland.exe'
    assert all(row[0]==properties['UpgradeCode'] for row in upgrades)
    assert sequence['InstallInitialize']<sequence['RemoveExistingProducts']<sequence['ProcessComponents']
    # A property-only Type 51 action restores the previous application directory;
    # executable, DLL, script and arbitrary additional custom actions stay forbidden.
    assert rows(db,'CustomAction')==[('RestoreInstallDirectory','51','INSTALLDIR','[PREVIOUSINSTALLDIR]')], 'Unexpected installer custom action'
    assert rows(db,'AppSearch')==[('PREVIOUSINSTALLDIR','RegisteredInstallDirectory')]
    assert rows(db,'RegLocator')==[('RegisteredInstallDirectory','1',registry['InstallRegistration'][2],'InstallDirectory','18')]
    for table in ['InstallExecuteSequence','InstallUISequence']:
        actions={row[0]:row for row in rows(db,table)}
        assert int(actions['AppSearch'][2])<int(actions['RestoreInstallDirectory'][2])<int(actions['CostInitialize'][2])
        assert actions['RestoreInstallDirectory'][1]=='PREVIOUSINSTALLDIR AND NOT INSTALLDIR'
    assert components['LegacyBrandCleanup'][4]=='OLDPRODUCTS AND PREVIOUSINSTALLDIR'
    assert set(rows(db,'RemoveFile'))=={
        ('RemoveEmptyStartMenu','Registration','','GoStreamsMenu','2'),
        ('RetireLegacyLauncher','LegacyBrandCleanup','GoStreams.exe','PREVIOUSINSTALLDIR','1')
    }, 'Unexpected installer cleanup target'
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
    # Reproduce the predecessor's file and shell names with the same upgrade and
    # component identities, then let Windows Installer perform the real upgrade.
    # Only branding is reversed; the fixture stays isolated by test_identity.
    legacy_builder=types.ModuleType('legacy_installer_builder')
    legacy_builder.__file__=str(ROOT/'scripts/build-windows-installer.py')
    legacy_source=Path(legacy_builder.__file__).read_text('utf-8').replace('Streamland.exe','GoStreams.exe').replace('STREAM~1|Streamland','GOSTRE~1|Go Streams').replace('Streamland','Go Streams')
    exec(compile(legacy_source,legacy_builder.__file__,'exec'),legacy_builder.__dict__)
    test_id=uuid.uuid4().hex;source=work/'fixture-source';source.mkdir()
    install=work/'Installed';desktop=work/'Desktop';menu=work/'StartMenu';data=work/'LocalUserData'/'Go Streams'/'data'
    for folder in [desktop,menu,data]:folder.mkdir(parents=True)
    (source/'public').mkdir();shutil.copy2(ROOT/'public/icon.ico',source/'public/icon.ico')
    # A fixture is sufficient to exercise Windows Installer's real transaction engine.
    (source/'GoStreams.exe').write_bytes(b'legacy fixture launcher; not executed')
    (source/'.installed').write_text('go-streams-installed-v1\n')
    (source/'revision.txt').write_text('baseline')
    one=work/'baseline.msi';baseline=legacy_builder.build_msi(source,one,'1.1.6',test_identity=test_id,legacy_directory_policy=True)
    (source/'GoStreams.exe').unlink()
    (source/'Streamland.exe').write_bytes(b'Streamland fixture launcher; not executed')
    (source/'revision.txt').write_text('updated')
    two=work/'upgrade.msi';upgraded=builder.build_msi(source,two,'1.2.0',test_identity=test_id)
    assert baseline['upgradeCode']==upgraded['upgradeCode'], 'Rename changed the installer upgrade identity'
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
    # Execute the pending removal/copy script inside the transaction before
    # provoking failure. This exercises real rollback of the legacy-file cleanup.
    view=db.OpenView("DELETE FROM `InstallExecuteSequence` WHERE `Action`='InstallExecute'");view.Execute(None);view.Close()
    msilib.add_data(db,'InstallExecuteSequence',[('InstallExecute',None,6500),('VerificationFailure','OLDPRODUCTS',6550)])
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
    def apply(file,name,override=True):
        msi.MsiEnableLogW(0x3fff,str(work/(name+'.log')),3)
        return int(msi.MsiInstallProductW(str(file),options if override else 'REBOOT=ReallySuppress'))
    try:
        code=apply(one,'install')
        if code not in (0,3010):return {'nativeInstallTested':False,'installerResult':code,'log':str(work/'install.log')}
        installed.append(baseline['productCode'])
        assert (install/'revision.txt').read_text()=='baseline'
        assert (install/'GoStreams.exe').is_file() and not (install/'Streamland.exe').exists()
        assert (desktop/'Go Streams.lnk').is_file() and (menu/'Go Streams'/'Go Streams.lnk').is_file()
        assert snapshot()==original
        (install/'user-added.txt').write_text('Unknown application files must survive')
        (install/'CloseGoStreams.cmd').write_text('User-created helper must survive')
        application_before={str(file.relative_to(install)):hashlib.sha256(file.read_bytes()).hexdigest() for file in install.rglob('*') if file.is_file()}
        # Upgrade must discover the registered custom directory without /INSTALLDIR.
        rejected=apply(failing,'rollback',override=False)
        assert rejected not in (0,3010), 'Controlled failed upgrade unexpectedly succeeded'
        assert (install/'revision.txt').read_text()=='baseline', 'Failed upgrade did not roll back application files'
        assert (install/'GoStreams.exe').is_file() and not (install/'Streamland.exe').exists(), 'Rollback did not restore the predecessor launcher'
        assert (desktop/'Go Streams.lnk').is_file() and not (desktop/'Streamland.lnk').exists(), 'Rollback did not restore the predecessor shortcut'
        assert snapshot()==original, 'Rollback changed existing user data'
        assert {str(file.relative_to(install)):hashlib.sha256(file.read_bytes()).hexdigest() for file in install.rglob('*') if file.is_file()}==application_before, 'Executed file cleanup/copy did not roll back exactly'
        code=apply(two,'upgrade',override=False);assert code in (0,3010), 'Upgrade failed: '+str(code)
        installed.append(upgraded['productCode'])
        assert (install/'revision.txt').read_text()=='updated'
        assert (install/'Streamland.exe').is_file(), 'Upgrade did not install Streamland.exe'
        assert not (install/'GoStreams.exe').exists(), 'Upgrade left the predecessor GoStreams.exe in the application folder'
        assert (install/'CloseGoStreams.cmd').read_text()=='User-created helper must survive'
        assert (install/'user-added.txt').read_text()=='Unknown application files must survive'
        assert not (desktop/'Go Streams.lnk').exists() and not (menu/'Go Streams'/'Go Streams.lnk').exists()
        assert (menu/'Streamland'/'Streamland.lnk').is_file()
        assert snapshot()==original
        assert (desktop/'Streamland.lnk').is_file()
        uninstall=int(msi.MsiConfigureProductExW(upgraded['productCode'],0,2,'REMOVE=ALL REBOOT=ReallySuppress'))
        assert uninstall in (0,3010), 'Uninstall failed: '+str(uninstall)
        assert not (install/'revision.txt').exists() and not (desktop/'Streamland.lnk').exists()
        assert not (install/'Streamland.exe').exists(), 'Uninstall lost the registered custom directory'
        assert (install/'CloseGoStreams.cmd').read_text()=='User-created helper must survive'
        assert (install/'user-added.txt').read_text()=='Unknown application files must survive'
        assert snapshot()==original
        return {'nativeInstallTested':True,'shortcutsCreated':True,'failedUpgradeRolledBack':True,'upgradeCompleted':True,'legacyBrandUpgradeCompleted':True,'legacyShortcutsAndExecutableRetired':True,'uninstallPreservedData':True,'profileHashesUnchanged':True,'registeredCustomDirectoryReused':True,'executedFileCleanupRolledBack':True,'unknownApplicationFilesPreserved':True}
    except Exception:
        # Keep native failures actionable without weakening installation checks.
        # These paths and logs belong only to the isolated synthetic fixture.
        traces={}
        for name in ['install','rollback','upgrade']:
            file=work/(name+'.log')
            if not file.exists():continue
            raw=file.read_bytes();text=raw.decode('utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8',errors='replace')
            lines=[line for line in text.splitlines() if any(word in line.lower() for word in ['findexisting','findrelated','removeexisting','gostreams.exe','streamland.exe','installdir','oldproducts','return value 3'])]
            traces[name]=lines[-100:]
        files={name:[str(file.relative_to(folder)) for file in folder.rglob('*') if file.is_file()] for name,folder in [('application',install),('desktop',desktop),('menu',menu)]}
        print(json.dumps({'nativeInstallerFailure':True,'fixtureFiles':files,'installerTraces':traces}),flush=True)
        raise
    finally:
        for product in reversed(installed):msi.MsiConfigureProductExW(product,0,2,'REMOVE=ALL REBOOT=ReallySuppress')
        msi.MsiEnableLogW(0,None,0)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package',type=Path,nargs='?')
    parser.add_argument('--native',action='store_true');parser.add_argument('--payload',action='store_true')
    parser.add_argument('--fixture-only',action='store_true',help='Require native legacy-brand upgrade verification without a full release package')
    args=parser.parse_args()
    if args.fixture_only:
        if args.package or args.native or args.payload:parser.error('--fixture-only cannot be combined with package, --native or --payload')
        work=ROOT/'.tmp'/('msi-brand-verification-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
        report=native_fixture(work)
        destination=ROOT/'release'/'Streamland-Windows-installer-verification.json';destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report),flush=True)
        if not report.get('nativeInstallTested'):raise SystemExit('Native Windows Installer verification could not run; the upgrade is not verified.')
        return
    if args.package is None:parser.error('package is required unless --fixture-only is selected')
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
