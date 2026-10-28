"""Exercise the shipping NSIS script with a tiny isolated per-user fixture."""
from pathlib import Path
import argparse, ctypes, hashlib, importlib.util, json, os, subprocess, time, uuid
ROOT=Path(__file__).resolve().parents[1]

def verify_directory_validation(work, nsis, builder):
    # Silent installation skips the directory page. Execute its actual callback
    # separately so a disabled Next button cannot pass the silent-install tests.
    shipping=(ROOT/'scripts/electron-installer.nsi').read_text('utf-8')
    callback='Function .onVerifyInstDir'+shipping.split('Function .onVerifyInstDir',1)[1].split('FunctionEnd',1)[0]+'FunctionEnd\n'
    probe=work/'directory-validation.exe';script=work/'directory-validation.nsi'
    data_root=work/'UserData'
    script.write_text('\n'.join([
        'Unicode true', '!include "LogicLib.nsh"', '!include "FileFunc.nsh"',
        'Name "Go Streams directory validation test"', 'RequestExecutionLevel user',
        'OutFile "'+builder.nsis_escape(probe)+'"', 'Var DataRoot', callback,
        'Function .onInit', 'StrCpy $DataRoot "'+builder.nsis_escape(data_root)+'"',
        'SetErrorLevel 2', 'Call .onVerifyInstDir', 'SetErrorLevel 0', 'Quit',
        'FunctionEnd', 'Section', 'SectionEnd', ''
    ]),encoding='utf-8')
    builder.run([nsis,'/V2',script])
    existing=work/'Existing';existing.mkdir()
    new=work/'New parent'/'Go Streams Electron'
    def check(target, allowed):
        result=subprocess.run([str(probe),'/S','/D='+str(target)],timeout=30,creationflags=subprocess.CREATE_NO_WINDOW)
        assert (result.returncode==0)==allowed, f'Directory validation: {target}: {result.returncode}'
    for target in [existing,new,work/'Acentos João'/'Go Streams Electron']:
        check(target,True)
    assert not new.parent.exists(), 'Validation must not create the destination'
    for target in [Path(work.anchor),os.environ['LOCALAPPDATA'],os.environ['USERPROFILE'],os.environ['WINDIR'],os.environ.get('ProgramFiles(x86)',os.environ['ProgramFiles']),data_root,data_root/'data',data_root/'new',data_root/'other'/'..'/'data']:
        check(target,False)
    return True

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--nsis',type=Path,required=True);args=parser.parse_args()
    spec=importlib.util.spec_from_file_location('builder',ROOT/'scripts/build-electron-windows.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    work=ROOT/'.tmp'/('nsis-install-verification-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
    directory_validation=verify_directory_validation(work,args.nsis,builder)
    source=work/'source';source.mkdir();(source/'GoStreams.exe').write_bytes(b'isolated fixture - never executed');(source/'.gostreams-electron-install').write_bytes(b'net.antoniofradique.gostreams\r\n')
    (source/'revision.txt').write_text('first');one=work/'one.exe';builder.compile_installer(source,one,work,args.nsis,'0.17.0',test_root=work)
    (source/'revision.txt').write_text('second');two=work/'two.exe';builder.compile_installer(source,two,work,args.nsis,'0.18.0',test_root=work)
    install=work/'New parent'/'Installed';data=work/'UserData'/'data';data.mkdir(parents=True)
    for relative,content in [('project.json',b'preserved project'),('vault.dpapi',b'protected fixture'),('electron-session/Network/Cookies',b'existing sessions')]:
        file=data/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(content)
    def snapshot():return {str(f.relative_to(data)):hashlib.sha256(f.read_bytes()).hexdigest() for f in data.rglob('*') if f.is_file()}
    original=snapshot()
    def apply(exe,target):return subprocess.run([str(exe),'/S','/D='+str(target)],timeout=120,creationflags=subprocess.CREATE_NO_WINDOW).returncode
    assert not install.parent.exists()
    assert apply(one,install)==0
    assert (install/'revision.txt').read_text()=='first' and (work/'Desktop/Go Streams.lnk').is_file()
    assert (work/'StartMenu/Go Streams/Go Streams.lnk').is_file() and snapshot()==original
    (install/'user-added.txt').write_text('unknown files must survive uninstall')
    kernel=ctypes.WinDLL('kernel32',use_last_error=True);kernel.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p];kernel.CreateFileW.restype=ctypes.c_void_p;kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.CreateFileW(str(install/'GoStreams.exe'),0x80000000,0,None,3,0,None)
    assert handle not in (None,ctypes.c_void_p(-1).value)
    try:assert apply(two,install)!=0
    finally:kernel.CloseHandle(handle)
    assert (install/'revision.txt').read_text()=='first' and snapshot()==original
    assert apply(two,install)==0 and (install/'revision.txt').read_text()=='second' and snapshot()==original
    assert apply(one,install)!=0 and (install/'revision.txt').read_text()=='second'
    foreign=work/'Foreign';foreign.mkdir();(foreign/'unrelated.txt').write_text('untouched');assert apply(one,foreign)!=0;assert (foreign/'unrelated.txt').read_text()=='untouched'
    uninstaller=install/'Uninstall Go Streams.exe';subprocess.run([str(uninstaller),'/S'],timeout=120,creationflags=subprocess.CREATE_NO_WINDOW)
    deadline=time.monotonic()+30
    while (install/'GoStreams.exe').exists() and time.monotonic()<deadline:time.sleep(.1)
    assert not (install/'GoStreams.exe').exists() and not (work/'Desktop/Go Streams.lnk').exists()
    assert snapshot()==original and (install/'user-added.txt').read_text()=='unknown files must survive uninstall'
    report={'directoryPageValidation':directory_validation,'createsMissingDestination':True,'install':True,'desktopAndStartMenuShortcuts':True,'runningApplicationUpgradeBlocked':True,'upgradePreservesProfilesAndSessions':True,'downgradeBlocked':True,'foreignDirectoryRejected':True,'uninstallPreservesDataAndUnknownFiles':True,'work':str(work)}
    (ROOT/'release/GoStreams-Electron-installer-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':main()
