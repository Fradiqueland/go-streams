"""Build a self-contained, per-user Windows MSI with upgrade-safe user data.

Build requirements: Windows, Python 3.11/3.12 (msilib), and the Windows .NET
Framework compiler. Users of the resulting MSI need no development tools.
Use --portable to reuse verified runtimes from an existing single-file EXE,
or --application-root to use a prepared application folder.
"""
from pathlib import Path
import argparse, ctypes, hashlib, json, os, re, shutil, subprocess, sys, uuid
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
UPGRADE_CODE='{F4CB227C-4D84-4EC0-ACE5-F9155087AE43}'
NAMESPACE=uuid.UUID(UPGRADE_CODE.strip('{}'))
REQUIRED=('runtime/win32-x64/node.exe','runtime/win32-x64/ffmpeg.exe','runtime/win32-x64/ffprobe.exe','vendor/yt-dlp/win32/yt-dlp.exe')
REGISTRY_KEY=r'Software\Antonio Fradique\Go Streams'

def guid(name):return '{'+str(uuid.uuid5(NAMESPACE,name)).upper()+'}'
def identity(prefix,name):return prefix+hashlib.sha256(name.encode()).hexdigest()[:24]
def digest(file):
    with Path(file).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def run(args,**options):
    result=subprocess.run([str(a) for a in args],capture_output=True,text=True,creationflags=subprocess.CREATE_NO_WINDOW,**options)
    if result.returncode:raise RuntimeError(result.stdout+'\n'+result.stderr)
    return result

def compiler():return Path(os.environ.get('WINDIR',r'C:\Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'

def user_profile_keypaths(db,registry,version):
    """Use per-user registry key paths for profile components (Windows ICE38)."""
    import msilib
    view=db.OpenView('SELECT `Component`, `Attributes` FROM `Component`');view.Execute(None)
    components=[]
    while True:
        row=view.Fetch()
        if row is None:break
        components.append((row.GetString(1),row.GetInteger(2)))
    view.Close()
    for component,attributes in components:
        if attributes&4:continue
        if not re.fullmatch(r'C[a-f0-9]{24}',component):raise ValueError('Unknown user profile component')
        key='R'+component
        msilib.add_data(db,'Registry',[(key,1,registry+'\\Components',component,version,component)])
        update=db.OpenView("UPDATE `Component` SET `Attributes`="+str(attributes|4)+", `KeyPath`='"+key+"' WHERE `Component`='"+component+"'")
        update.Execute(None);update.Close()

def prepare_application(work,portable=None,application_root=None):
    application=work/'application';application.mkdir()
    if portable:
        code=work/'ExtractResources.cs'
        code.write_text('''using System;using System.IO;using System.Reflection;
class ExtractResources {static void Main(string[] args) {var assembly=Assembly.LoadFile(Path.GetFullPath(args[0]));
foreach(string name in new[]{"GoStreams.Payload","GoStreams.Manifest"}) {
using(var input=assembly.GetManifestResourceStream(name)) {if(input==null)throw new Exception("Not a Go Streams single-file executable");
using(var output=File.Create(Path.Combine(args[1],name+".bin")))input.CopyTo(output);}}}}
''',encoding='utf-8')
        extract=work/'ExtractResources.exe'
        run([compiler(),'/nologo','/target:exe','/out:'+str(extract),code])
        run([extract,Path(portable).resolve(),work])
        archive=work/'GoStreams.Payload.bin'
        manifest=ET.parse(work/'GoStreams.Manifest.bin').getroot()
        if manifest.tag!='bundle' or manifest.get('schema')!='1' or digest(archive)!=manifest.get('sha256'):raise ValueError('Portable package integrity check failed')
        expected={entry.get('path'):entry.attrib for entry in manifest.findall('file')}
        if len(expected)!=len(manifest.findall('file')):raise ValueError('Duplicate manifest file')
        with ZipFile(archive) as package:
            names=package.namelist()
            if len(names)!=len(set(n.casefold() for n in names)) or set(names)!=set(expected):raise ValueError('Unexpected package entries')
            for entry in package.infolist():
                name=entry.filename
                if '\\' in name or any(p in ('','.','..') or ':' in p for p in name.split('/')):raise ValueError('Unsafe package path')
                if name.startswith(('data/','.tmp/')):raise ValueError('Private files in package')
                target=(application/name).resolve()
                if not target.is_relative_to(application.resolve()):raise ValueError('Escaping package path')
                info=expected[name]
                if entry.file_size!=int(info['bytes']):raise ValueError('Incorrect package size')
                with package.open(entry) as stream:
                    if hashlib.file_digest(stream,'sha256').hexdigest()!=info['sha256']:raise ValueError('Package file hash mismatch')
                if name.startswith(('runtime/','vendor/')):
                    target.parent.mkdir(parents=True,exist_ok=True)
                    with package.open(entry) as source,target.open('wb') as output:shutil.copyfileobj(source,output,1024*1024)
    elif application_root:
        for folder in ['runtime','vendor']:
            source=Path(application_root).resolve()/folder
            if source.is_dir():shutil.copytree(source,application/folder)
    else:raise ValueError('Supply --portable or --application-root; the installer never downloads unchecked runtimes')
    for name in REQUIRED:
        if not (application/name).is_file():raise ValueError('Missing included runtime: '+name)
    for folder in ['src','public']:shutil.copytree(ROOT/folder,application/folder)
    for name in ['package.json','README.md']:shutil.copy2(ROOT/name,application/name)
    (application/'.installed').write_text('go-streams-installed-v1\n',encoding='ascii')
    version=json.loads((ROOT/'package.json').read_text('utf-8'))['version']
    assembly=work/'AssemblyVersion.cs'
    assembly.write_text('using System.Reflection;\n[assembly: AssemblyTitle("Go Streams")]\n[assembly: AssemblyProduct("Go Streams")]\n[assembly: AssemblyCompany("Antonio Fradique")]\n[assembly: AssemblyVersion("'+version+'.0")]\n[assembly: AssemblyFileVersion("'+version+'.0")]\n',encoding='utf-8')
    run([compiler(),'/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/win32icon:'+str(ROOT/'public/icon.ico'),'/out:'+str(application/'GoStreams.exe'),ROOT/'scripts/Launcher.cs',assembly])
    return application

def build_msi(application,output,version,*,test_identity=None):
    try:import msilib, msilib.schema, msilib.sequence
    except ImportError:raise RuntimeError('Build the MSI with Windows Python 3.11 or 3.12 (msilib is included there).')
    if not re.fullmatch(r'\d{1,3}\.\d{1,3}\.\d{1,5}',version):raise ValueError('Invalid installer version')
    if output.exists():raise FileExistsError('Preserve the existing MSI before rebuilding: '+str(output))
    upgrade=UPGRADE_CODE if test_identity is None else guid('test-upgrade:'+test_identity)
    product=guid('product:'+upgrade+':'+version)
    registry=REGISTRY_KEY if test_identity is None else REGISTRY_KEY+'\\Verification\\'+test_identity
    db=msilib.init_database(str(output),msilib.schema,'Go Streams' if test_identity is None else 'Go Streams Installer Verification',product,version,'Antonio Fradique')
    summary=db.GetSummaryInformation(20)
    summary.SetProperty(msilib.PID_TEMPLATE,'x64;1033')
    summary.SetProperty(msilib.PID_PAGECOUNT,500)
    summary.SetProperty(msilib.PID_WORDCOUNT,10) # compressed, long names, non-elevated per-user package
    summary.SetProperty(msilib.PID_APPNAME,'Go Streams MSI Builder')
    summary.Persist()
    add=lambda table,rows:msilib.add_data(db,table,rows)
    add('Property',[
        ('UpgradeCode',upgrade),('INSTALLLEVEL','1'),('DefaultUIFont','Normal'),
        ('REBOOT','ReallySuppress'),('MSIRESTARTMANAGERCONTROL','DisableShutdown'),
        ('ARPPRODUCTICON','GoStreamsIcon'),('ARPURLINFOABOUT','https://AntonioFradique.net'),
        ('SecureCustomProperties','OLDPRODUCTS;NEWERPRODUCTS;LEGACYDATADIR'),
        ('REINSTALLMODE','amus'),('ARPCOMMENTS','User projects and profiles are preserved when updating or uninstalling.')
    ])
    add('Directory',[
        ('TARGETDIR',None,'SourceDir'),('LocalAppDataFolder','TARGETDIR','.'),
        ('ProgramsDir','LocalAppDataFolder','Programs'),('INSTALLDIR','ProgramsDir','GOSTRE~1|Go Streams'),
        ('DesktopFolder','TARGETDIR','.'),('ProgramMenuFolder','TARGETDIR','.'),('GoStreamsMenu','ProgramMenuFolder','GOSTRE~1|Go Streams')
    ])
    add('Feature',[('Main',None,'Go Streams','Complete application and all included runtimes',1,1,'INSTALLDIR',0)])
    directories={'':'INSTALLDIR'}
    files=sorted(file for file in application.rglob('*') if file.is_file())
    if any(file.is_symlink() or any(p in ('data','.tmp') for p in file.relative_to(application).parts) for file in files):raise ValueError('Private data or symlink in installation')
    cab=application.parent/'application.cab';cab_files=[];records=[]
    for sequence,file in enumerate(files,1):
        relative=file.relative_to(application).as_posix()
        parent=file.relative_to(application).parent.as_posix()
        if parent=='.':parent=''
        parts=parent.split('/') if parent else []
        for count in range(1,len(parts)+1):
            folder='/'.join(parts[:count])
            if folder not in directories:
                base='/'.join(parts[:count-1]);directory=identity('D',folder);long=parts[count-1]
                add('Directory',[(directory,directories[base],identity('D',long)[:8].upper()+'|'+long)])
                directories[folder]=directory
        key=identity('F',relative);component=identity('C',relative)
        add('Component',[(component,guid('component:'+upgrade+':'+relative),directories[parent],256,None,key)])
        add('FeatureComponents',[('Main',component)])
        short=identity('F',file.name)[:8].upper()+'|'+file.name
        add('File',[(key,component,short,file.stat().st_size,None,None,16896,sequence)])
        cab_files.append((str(file),key));records.append({'path':relative,'id':key,'bytes':file.stat().st_size,'sha256':digest(file)})
    user_profile_keypaths(db,registry,version)
    # One HKCU-backed component owns the application shortcuts and registration.
    add('Component',[('Registration',guid('registration:'+upgrade),'INSTALLDIR',260,None,'InstallRegistration')])
    add('FeatureComponents',[('Main','Registration')])
    add('Registry',[
        ('InstallRegistration',1,registry,'InstallDirectory','[INSTALLDIR]','Registration'),
        ('PortableSource',1,registry,'LegacyPortableRoot','[SourceDir]','Registration'),
        ('PortableData',1,registry,'LegacyDataDirectory','[LEGACYDATADIR]','Registration')
    ])
    executable=identity('F','GoStreams.exe')
    add('Icon',[('GoStreamsIcon',msilib.Binary(str(application/'public/icon.ico')))])
    add('Shortcut',[
        ('DesktopShortcut','DesktopFolder','GOSTRE~1|Go Streams','Registration','[#'+executable+']',None,'Go Streams',None,'GoStreamsIcon',0,1,'INSTALLDIR'),
        ('StartMenuShortcut','GoStreamsMenu','GOSTRE~1|Go Streams','Registration','[#'+executable+']',None,'Go Streams',None,'GoStreamsIcon',0,1,'INSTALLDIR')
    ])
    add('CreateFolder',[('GoStreamsMenu','Registration')])
    add('RemoveFile',[('RemoveEmptyStartMenu','Registration',None,'GoStreamsMenu',2)])
    add('Upgrade',[(upgrade,None,version,None,1,None,'OLDPRODUCTS'),(upgrade,version,None,None,258,None,'NEWERPRODUCTS')])
    add('LaunchCondition',[
        ('Installed OR VersionNT64','Go Streams requires 64-bit Windows.'),
        ('Installed OR NOT NEWERPRODUCTS','A newer Go Streams is already installed. Your data has not been changed.')
    ])
    execute=[(action,condition,1510 if action=='RemoveExistingProducts' else sequence) for action,condition,sequence in msilib.sequence.InstallExecuteSequence]
    # Related products must be detected before downgrade protection is evaluated.
    execute=[(action,condition,250 if action=='LaunchConditions' else sequence) for action,condition,sequence in execute]
    add('InstallExecuteSequence',execute)
    ui=[('FindRelatedProducts',None,200),('LaunchConditions',None,250),('CostInitialize',None,800),('FileCost',None,900),('CostFinalize',None,1000),('WelcomeDlg','NOT REMOVE~="ALL"',1100),('ProgressDlg',None,1290),('ExecuteAction',None,1300),('ExitDialog',None,-1),('FatalError',None,-3),('UserExit',None,-2)]
    add('InstallUISequence',ui)
    add('TextStyle',[('Normal','Tahoma',9,None,0),('Title','Tahoma',13,None,1)])
    welcome=msilib.Dialog(db,'WelcomeDlg',50,50,400,300,3,'Go Streams '+version,'Install','Install','Cancel')
    welcome.text('Heading',18,14,364,30,3,'{\\Title}Install Go Streams '+version)
    welcome.text('Intro',18,50,364,34,3,'All application components will be installed. Close Go Streams before updating.')
    welcome.text('Folder',18,91,364,38,3,'Application folder:\n[INSTALLDIR]')
    welcome.text('Data',18,137,364,43,3,'Projects, settings, credentials and browser profiles stay in your user data folder. Updating and uninstalling preserve that folder.')
    welcome.text('LegacyLabel',18,187,364,29,3,'Optional: previous portable data folder (containing project.json). Leave empty to reuse your normal Go Streams data.')
    welcome.control('LegacyData','Edit',18,220,364,19,3,'LEGACYDATADIR',None,'Install',None)
    install=welcome.pushbutton('Install',210,264,80,20,3,'Install / Repair','Cancel')
    install.event('[REINSTALL]','ALL','Installed',1);install.event('EndDialog','Return','1',2)
    welcome.pushbutton('Cancel',302,264,80,20,3,'Cancel',None).event('EndDialog','Exit')
    progress=msilib.Dialog(db,'ProgressDlg',50,50,400,145,1,'Installing Go Streams','Status',None,None)
    progress.text('Heading',18,15,364,28,3,'{\\Title}Installing Go Streams')
    progress.text('Status',18,56,364,22,3,'Please wait while Windows installs the application.')
    progress.control('Progress','ProgressBar',18,90,364,14,65537,None,None,None,None).mapping('SetProgress','Progress')
    for name,message in [('ExitDialog','Setup is complete. Your user data has been preserved. If installed, open Go Streams using its desktop or Start menu shortcut.'),('FatalError','Installation did not complete. Your existing projects and profiles have been preserved.'),('UserExit','Installation was cancelled. Your user data has not been removed.')]:
        dialog=msilib.Dialog(db,name,50,50,400,165,3,'Go Streams','Finish','Finish','Finish')
        dialog.text('Message',18,25,364,75,3,message)
        dialog.pushbutton('Finish',302,128,80,20,3,'Close',None).event('EndDialog','Return')
    db.Commit()
    print(json.dumps({'phase':'compressing','files':len(files),'bytes':sum(f.stat().st_size for f in files)}),flush=True)
    msilib.FCICreate(str(cab),cab_files)
    add('Media',[(1,len(files),None,'#ApplicationCab',None,None)])
    msilib.add_stream(db,'ApplicationCab',str(cab));db.Commit();db=None
    return {'version':version,'productCode':product,'upgradeCode':upgrade,'files':records,'cabinetSHA256':digest(cab),'dataDirectory':'%LOCALAPPDATA%\\Go Streams\\data','installDirectory':'%LOCALAPPDATA%\\Programs\\Go Streams','shortcuts':['Desktop','Start menu'],'userDataIncluded':False,'nativeInstallTested':False}

def main():
    parser=argparse.ArgumentParser(description=__doc__);source=parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--portable',type=Path);source.add_argument('--application-root',type=Path)
    parser.add_argument('--replace',action='store_true',help='Replace the generated release MSI only after the new package is complete')
    parser.add_argument('--keep-work',action='store_true',help='Retain this build staging folder for diagnosis')
    args=parser.parse_args()
    version=json.loads((ROOT/'package.json').read_text('utf-8'))['version']
    work=ROOT/'.tmp'/('installer-'+version+'-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
    application=prepare_application(work,args.portable,args.application_root)
    print(json.dumps({'phase':'application-ready','path':str(application),'version':version}),flush=True)
    candidate=work/('GoStreams-'+version+'-Windows-Setup.msi')
    report=build_msi(application,candidate,version)
    output=ROOT/'release'/candidate.name
    if output.exists() and not args.replace:raise FileExistsError('Preserve the existing installer or pass --replace: '+str(output))
    if output.is_symlink():raise ValueError('Installer output must be a regular file')
    os.replace(candidate,output)
    report.update(file=str(output),bytes=output.stat().st_size,sha256=digest(output),workDirectory=str(work),applicationDirectory=str(application))
    if not args.keep_work:
        if work.parent.resolve()!=(ROOT/'.tmp').resolve() or not work.name.startswith('installer-'):raise ValueError('Unsafe build staging cleanup')
        try:shutil.rmtree(work);report['workCleaned']=True
        except OSError as error:report.update(workCleaned=False,cleanupError=str(error))
    (ROOT/'release'/('GoStreams-'+version+'-Windows-Setup-build.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'installer':str(output),'bytes':report['bytes'],'sha256':report['sha256'],'work':str(work)}),flush=True)

if __name__=='__main__':main()
