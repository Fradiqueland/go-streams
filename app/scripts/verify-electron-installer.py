"""Exercise the shipping NSIS script with a tiny isolated per-user fixture."""
from pathlib import Path
import argparse, ctypes, hashlib, importlib.util, json, os, subprocess, time, uuid
ROOT=Path(__file__).resolve().parents[1]

def run_installer(exe, target=None, timeout=120):
    # NSIS consumes /D= as the unquoted remainder of the Windows command line.
    # Passing an argv list makes Python quote paths with spaces, hiding /D=.
    command=subprocess.list2cmdline([str(exe),'/S'])
    if target is not None:command+=' /D='+str(target)
    return subprocess.run(command,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW).returncode

def verify_directory_validation(work, nsis, builder):
    # Silent installation skips the directory page. Execute its actual callback
    # separately so a disabled Next button cannot pass the silent-install tests.
    shipping=(ROOT/'scripts/electron-installer.nsi').read_text('utf-8')
    callback='Function .onVerifyInstDir'+shipping.split('Function .onVerifyInstDir',1)[1].split('FunctionEnd',1)[0]+'FunctionEnd\n'
    probe=work/'directory-validation.exe';script=work/'directory-validation.nsi'
    data_root=work/'UserData'
    script.write_text('\n'.join([
        'Unicode true', '!include "LogicLib.nsh"', '!include "FileFunc.nsh"',
        'Name "Streamland directory validation test"', 'RequestExecutionLevel user',
        'OutFile "'+builder.nsis_escape(probe)+'"', 'Var DataRoot', callback,
        'Function .onInit', 'StrCpy $DataRoot "'+builder.nsis_escape(data_root)+'"',
        'SetErrorLevel 2', 'Call .onVerifyInstDir', 'SetErrorLevel 0', 'Quit',
        'FunctionEnd', 'Section', 'SectionEnd', ''
    ]),encoding='utf-8')
    builder.run([nsis,'/V2',script])
    existing=work/'Existing';existing.mkdir()
    new=work/'New parent'/'Streamland Electron'
    def check(target, allowed):
        result=run_installer(probe,target,timeout=30)
        assert (result==0)==allowed, f'Directory validation: {target}: {result}'
    for target in [existing,new,work/'Acentos João'/'Streamland Electron']:
        check(target,True)
    assert not new.parent.exists(), 'Validation must not create the destination'
    for target in [Path(work.anchor),os.environ['LOCALAPPDATA'],os.environ['USERPROFILE'],os.environ['WINDIR'],os.environ.get('ProgramFiles(x86)',os.environ['ProgramFiles']),data_root,data_root/'data',data_root/'new',data_root/'other'/'..'/'data']:
        check(target,False)
    return True

def verify_legacy_upgrade(work, nsis, builder):
    """Install the predecessor's real identity, then exercise shipping setup."""
    import winreg
    work.mkdir()
    ident=hashlib.sha256(str(work).encode()).hexdigest()[:16]
    install_key=r'Software\Antonio Fradique\Go Streams\ElectronTest'+'\\'+ident
    uninstall_key=r'Software\Microsoft\Windows\CurrentVersion\Uninstall\GoStreams.ElectronTest.'+ident
    install=work/'Old application location'/'Go Streams Electron'
    desktop=work/'Desktop';old_menu=work/'StartMenu'/'Go Streams';new_menu=work/'StartMenu'/'Streamland'
    source=work/'legacy-source';source.mkdir()
    (source/'GoStreams.exe').write_bytes(b'legacy launcher fixture - never executed')
    (source/'.gostreams-electron-install').write_bytes(b'net.antoniofradique.gostreams\r\n')
    (source/'revision.txt').write_text('legacy')
    baseline=work/'legacy.exe';script=work/'legacy.nsi';escape=builder.nsis_escape
    # A tiny native baseline records the predecessor's exact ownership marker,
    # registry identity and shell paths. It is isolated from the real installation.
    script.write_text('\n'.join([
        'Unicode true', 'Name "Go Streams legacy upgrade fixture"', 'RequestExecutionLevel user',
        'OutFile "'+escape(baseline)+'"', 'Section', 'SetShellVarContext current', 'SetRegView 64',
        'SetOutPath "$INSTDIR"', 'File /r "'+escape(source)+'\\*"',
        'WriteUninstaller "$INSTDIR\\Uninstall Go Streams.exe"',
        'CreateDirectory "'+escape(desktop)+'"', 'CreateDirectory "'+escape(old_menu)+'"',
        'CreateShortCut "'+escape(desktop)+'\\Go Streams.lnk" "$INSTDIR\\GoStreams.exe"',
        'CreateShortCut "'+escape(old_menu)+'\\Go Streams.lnk" "$INSTDIR\\GoStreams.exe"',
        'WriteRegStr HKCU "'+escape(install_key)+'" "InstallDir" "$INSTDIR"',
        'WriteRegStr HKCU "'+escape(install_key)+'" "DisplayVersion" "1.1.6"',
        'WriteRegStr HKCU "'+escape(uninstall_key)+'" "DisplayName" "Go Streams (Electron)"',
        'SectionEnd', 'Section "Uninstall"', 'SetRegView 64',
        'Delete "$INSTDIR\\GoStreams.exe"', 'Delete "$INSTDIR\\Uninstall Go Streams.exe"',
        'DeleteRegKey HKCU "'+escape(install_key)+'"', 'DeleteRegKey HKCU "'+escape(uninstall_key)+'"',
        'SectionEnd', ''
    ]),encoding='utf-8')
    builder.run([nsis,'/V2',script])
    source_new=work/'source';source_new.mkdir()
    (source_new/'Streamland.exe').write_bytes(b'Streamland launcher fixture - never executed')
    (source_new/'.gostreams-electron-install').write_bytes((source/'.gostreams-electron-install').read_bytes())
    (source_new/'revision.txt').write_text('Streamland')
    upgrade=work/'streamland.exe';builder.compile_installer(source_new,upgrade,work,nsis,'1.2.0',test_root=work)
    data=work/'UserData'/'data';data.mkdir(parents=True)
    for relative,value in [('project.json',b'{"channels":[{"name":"Existing channel"}],"playlists":[{"name":"Existing playlist"}]}'),('vault.dpapi',b'protected credentials'),('electron-session/Network/Cookies',b'authenticated sessions'),('electron-session/Local Storage/leveldb/000003.log',b'saved language and production preferences')]:
        file=data/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(value)
    def hashes(folder):return {str(f.relative_to(folder)):hashlib.sha256(f.read_bytes()).hexdigest() for f in folder.rglob('*') if f.is_file()}
    original=hashes(data)
    assert run_installer(baseline,install)==0
    assert (install/'GoStreams.exe').is_file() and (desktop/'Go Streams.lnk').is_file() and (old_menu/'Go Streams.lnk').is_file()
    (old_menu/'user-added.txt').write_text('retain unknown menu files')
    before=hashes(install)
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p]
    kernel.CreateFileW.restype=ctypes.c_void_p;kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.CreateFileW(str(install/'GoStreams.exe'),0x80000000,0,None,3,0,None)
    assert handle not in (None,ctypes.c_void_p(-1).value)
    try:assert run_installer(upgrade)!=0, 'Upgrade accepted the running predecessor'
    finally:kernel.CloseHandle(handle)
    assert hashes(install)==before and hashes(data)==original, 'Rejected upgrade changed application or user data'
    # No /D override: discovery must reuse the prior registration automatically.
    assert run_installer(upgrade)==0
    assert (install/'Streamland.exe').read_bytes()==(source_new/'Streamland.exe').read_bytes()
    assert (install/'revision.txt').read_text()=='Streamland' and hashes(data)==original
    assert not (install/'GoStreams.exe').exists() and not (install/'Uninstall Go Streams.exe').exists()
    assert not (desktop/'Go Streams.lnk').exists() and not (old_menu/'Go Streams.lnk').exists()
    assert (desktop/'Streamland.lnk').is_file() and (new_menu/'Streamland.lnk').is_file()
    assert (old_menu/'user-added.txt').read_text()=='retain unknown menu files'
    for key,name,expected in [(install_key,'InstallDir',str(install)),(uninstall_key,'DisplayName','Streamland (Electron)'),(uninstall_key,'DisplayIcon',str(install/'Streamland.exe'))]:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key,0,winreg.KEY_READ|winreg.KEY_WOW64_64KEY) as entry:
            assert winreg.QueryValueEx(entry,name)[0]==expected, 'Upgrade registration differs: '+name
    uninstaller=install/'Uninstall Streamland.exe'
    assert subprocess.run([str(uninstaller),'/S'],timeout=120,creationflags=subprocess.CREATE_NO_WINDOW).returncode==0
    deadline=time.monotonic()+30
    while (install/'Streamland.exe').exists() and time.monotonic()<deadline:time.sleep(.1)
    assert not (install/'Streamland.exe').exists() and not (desktop/'Streamland.lnk').exists()
    assert hashes(data)==original and (old_menu/'user-added.txt').is_file()
    return {'legacyRunningApplicationBlocked':True,'legacyInstallDirectoryReused':True,'legacyShortcutsAndExecutableRetired':True,'existingProjectPreferencesAndSessionsPreserved':True,'unknownMenuFilesPreserved':True}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--nsis',type=Path,required=True);args=parser.parse_args()
    spec=importlib.util.spec_from_file_location('builder',ROOT/'scripts/build-electron-windows.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    work=ROOT/'.tmp'/('nsis-install-verification-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
    directory_validation=verify_directory_validation(work,args.nsis,builder)
    source=work/'source';source.mkdir();(source/'Streamland.exe').write_bytes(b'isolated fixture - never executed');(source/'.gostreams-electron-install').write_bytes(b'net.antoniofradique.gostreams\r\n')
    (source/'revision.txt').write_text('first');one=work/'one.exe';builder.compile_installer(source,one,work,args.nsis,'0.17.0',test_root=work)
    (source/'revision.txt').write_text('second');two=work/'two.exe';builder.compile_installer(source,two,work,args.nsis,'0.18.0',test_root=work)
    install=work/'New parent'/'Installed';data=work/'UserData'/'data';data.mkdir(parents=True)
    for relative,content in [('project.json',b'preserved project'),('vault.dpapi',b'protected fixture'),('electron-session/Network/Cookies',b'existing sessions')]:
        file=data/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(content)
    def snapshot():return {str(f.relative_to(data)):hashlib.sha256(f.read_bytes()).hexdigest() for f in data.rglob('*') if f.is_file()}
    original=snapshot()
    apply=run_installer
    # Silent setup skips the directory page, but must enforce the same boundary.
    forbidden=work/'UserData'/'empty-application-folder'
    assert apply(one,forbidden)!=0, 'Silent setup accepted a user-data application folder'
    assert not forbidden.exists(), 'Rejected silent setup created application files'
    assert not install.parent.exists()
    assert apply(one,install)==0
    assert (install/'revision.txt').read_text()=='first' and (work/'Desktop/Streamland.lnk').is_file()
    assert (work/'StartMenu/Streamland/Streamland.lnk').is_file() and snapshot()==original
    (install/'user-added.txt').write_text('unknown files must survive uninstall')
    kernel=ctypes.WinDLL('kernel32',use_last_error=True);kernel.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p];kernel.CreateFileW.restype=ctypes.c_void_p;kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.CreateFileW(str(install/'Streamland.exe'),0x80000000,0,None,3,0,None)
    assert handle not in (None,ctypes.c_void_p(-1).value)
    try:assert apply(two,install)!=0
    finally:kernel.CloseHandle(handle)
    assert (install/'revision.txt').read_text()=='first' and snapshot()==original
    assert apply(two,install)==0 and (install/'revision.txt').read_text()=='second' and snapshot()==original
    assert apply(one,install)!=0 and (install/'revision.txt').read_text()=='second'
    foreign=work/'Foreign';foreign.mkdir();(foreign/'unrelated.txt').write_text('untouched');assert apply(one,foreign)!=0;assert (foreign/'unrelated.txt').read_text()=='untouched'
    uninstaller=install/'Uninstall Streamland.exe';subprocess.run([str(uninstaller),'/S'],timeout=120,creationflags=subprocess.CREATE_NO_WINDOW)
    deadline=time.monotonic()+30
    while (install/'Streamland.exe').exists() and time.monotonic()<deadline:time.sleep(.1)
    assert not (install/'Streamland.exe').exists() and not (work/'Desktop/Streamland.lnk').exists()
    assert snapshot()==original and (install/'user-added.txt').read_text()=='unknown files must survive uninstall'
    report={'directoryPageValidation':directory_validation,'silentDirectoryValidation':True,'createsMissingDestination':True,'install':True,'desktopAndStartMenuShortcuts':True,'runningApplicationUpgradeBlocked':True,'upgradePreservesProfilesAndSessions':True,'downgradeBlocked':True,'foreignDirectoryRejected':True,'uninstallPreservesDataAndUnknownFiles':True,'work':str(work)}
    report['legacyBrandUpgrade']=verify_legacy_upgrade(work/'legacy-brand-upgrade',args.nsis,builder)
    (ROOT/'release/Streamland-Electron-installer-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':main()
