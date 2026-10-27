"""Prepare Mac-Portable/GoStreams.app and a ZIP with Unix metadata.
Uses the built Mac app; the Windows release is not altered.
"""
from pathlib import Path
import argparse, hashlib, json, os, plistlib, shutil, stat, tempfile, zipfile
ROOT=Path(__file__).resolve().parents[1]

def digest(file):
    with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def executable(relative):
    return (relative=='Contents/MacOS/GoStreams' or relative.endswith('/vendor/yt-dlp/darwin/yt-dlp') or ('/runtime/darwin-' in relative and Path(relative).name in ('node','ffmpeg','ffprobe')))

def entries(bundle):
    for base, directories, files in os.walk(bundle,followlinks=False):
        for name in sorted(directories+files):
            item=Path(base)/name;relative=item.relative_to(bundle).as_posix();mode=item.lstat().st_mode
            if stat.S_ISLNK(mode):
                target=os.readlink(item)
                if os.path.isabs(target) or not item.resolve(strict=True).is_relative_to(bundle.resolve()):raise ValueError('External application symlink: '+relative)
                yield item,relative,stat.S_IFLNK|0o777,target.encode('utf-8')
            elif stat.S_ISDIR(mode):yield item,relative,stat.S_IFDIR|0o755,None
            elif stat.S_ISREG(mode):
                if os.name=='nt':mode=stat.S_IFREG|(0o755 if executable(relative) else 0o644)
                yield item,relative,mode,None
            else:raise ValueError('Special application file: '+relative)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--replace',action='store_true');parser.add_argument('--destination',type=Path);args=parser.parse_args()
    version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version'];release=ROOT/'release'
    source=release/f'GoStreams-{version}-mac'/'GoStreams.app'
    destination=(args.destination or release/'Mac-Portable').resolve();output=release/f'GoStreams-v{version}-Mac-Portable.zip';report_path=release/f'GoStreams-v{version}-Mac-Portable-verification.json'
    if destination.name!='Mac-Portable' or not destination.is_relative_to(release.resolve()):raise ValueError('Portable destination must be a Mac-Portable folder inside release')
    destination.parent.mkdir(parents=True,exist_ok=True)
    if (destination.exists() or output.exists()) and not args.replace:raise FileExistsError('Preserve existing Mac-Portable delivery before rebuilding.')
    if destination.exists():
        if destination.is_symlink() or not destination.resolve().is_relative_to(release.resolve()):raise ValueError('Unsafe portable replacement')
        existing=json.loads((destination/'mac-portable-manifest.json').read_text(encoding='utf-8'))
        if existing.get('product')!='Go Streams' or existing.get('version')!=version:raise ValueError('Unrelated portable folder')
    metadata=plistlib.loads((source/'Contents/Info.plist').read_bytes())
    if metadata['CFBundleShortVersionString']!=version:raise ValueError('Stale application build')
    source_entries=list(entries(source))
    # Compare every shipped byte with the current, verified build inputs.
    # Packaging does not depend on an older delivery or a source-code ZIP.
    expected={}
    def expect(file,relative):expected[relative]=file
    for folder in ['src','public']:
        for file in (ROOT/folder).rglob('*'):
            if file.is_file():expect(file,'Contents/Resources/app/'+file.relative_to(ROOT).as_posix())
    for name in ['package.json','README.md']:expect(ROOT/name,'Contents/Resources/app/'+name)
    for target in ['darwin-x64','darwin-arm64']:
        directory=ROOT/'vendor/runtime'/target
        manifest=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
        if manifest['target']!=target:raise ValueError('Runtime target mismatch')
        for entry in manifest['files']:
            file=directory/entry['name']
            if file.parent!=directory or file.stat().st_size!=entry['bytes'] or digest(file)!=entry['sha256']:raise ValueError('Runtime integrity mismatch')
            expect(file,'Contents/Resources/app/runtime/'+target+'/'+entry['name'])
        expect(directory/'manifest.json','Contents/Resources/app/runtime/'+target+'/manifest.json')
    directory=ROOT/'vendor/yt-dlp';manifest=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    for entry in manifest['files']:
        if 'darwin' not in entry['platforms']:continue
        file=directory/entry['path']
        if not file.resolve().is_relative_to(directory.resolve()) or file.stat().st_size!=entry['bytes']:raise ValueError('Downloader integrity mismatch')
        checksum=digest(file) if entry.get('sha256') else hashlib.sha1(b'blob '+str(file.stat().st_size).encode()+b'\0'+file.read_bytes()).hexdigest()
        if checksum!=entry.get('sha256',entry.get('gitSha1')):raise ValueError('Downloader integrity mismatch')
        expect(file,'Contents/Resources/app/vendor/yt-dlp/'+entry['path'])
    expect(directory/'manifest.json','Contents/Resources/app/vendor/yt-dlp/manifest.json')
    launcher=ROOT/'vendor/mac-launcher/GoStreams';manifest=json.loads((launcher.parent/'manifest.json').read_text(encoding='utf-8'))
    if launcher.stat().st_size!=manifest['bytes'] or digest(launcher)!=manifest['sha256']:raise ValueError('Launcher integrity mismatch')
    if digest(ROOT/'scripts/mac-launcher/main.go')!=manifest['sourceSha256']:raise ValueError('Launcher source changed without rebuilding')
    expect(launcher,'Contents/MacOS/GoStreams')
    for name in ['LICENSE','PATENTS']:expect(launcher.parent/name,'Contents/Resources/Go-'+name+'.txt')
    expect(ROOT/'public/icon.icns','Contents/Resources/GoStreams.icns')
    observed={relative for _,relative,mode,_ in source_entries if not stat.S_ISDIR(mode)}
    if observed!=set(expected)|{'Contents/Info.plist'}:raise ValueError('Unexpected application resources')
    for file,relative,mode,link in source_entries:
        if stat.S_ISDIR(mode) or relative=='Contents/Info.plist':continue
        if link is not None or digest(file)!=digest(expected[relative]):raise ValueError('Stale application resource: '+relative)
    if metadata.get('CFBundleExecutable')!='GoStreams' or metadata.get('CFBundleIconFile')!='GoStreams.icns':raise ValueError('Invalid Mac entry or icon')
    scratch_root=ROOT/'.tmp';scratch_root.mkdir(exist_ok=True);stage=Path(tempfile.mkdtemp(prefix='mac-portable-',dir=scratch_root)).resolve()
    if not stage.is_relative_to(scratch_root.resolve()):raise ValueError('Unsafe packaging directory')
    try:
        folder=stage/'Mac-Portable';folder.mkdir();shutil.copytree(source,folder/'GoStreams.app',symlinks=True,copy_function=shutil.copy2)
        records=[]
        for item,relative,mode,link in entries(folder/'GoStreams.app'):
            if stat.S_ISDIR(mode):continue
            records.append({'path':'GoStreams.app/'+relative,'mode':oct(stat.S_IMODE(mode)),'kind':'symlink' if link is not None else 'file','sha256':hashlib.sha256(link).hexdigest() if link is not None else digest(item),'bytes':len(link) if link is not None else item.stat().st_size})
        manifest={'product':'Go Streams','version':version,'macEntry':'GoStreams.app','architectures':['x64','arm64'],'minimumMacOS':metadata['LSMinimumSystemVersion'],'externalRuntimesRequired':False,'nativeMacExecutionVerified':False,'appDeveloperIDSigned':False,'notarized':False,'files':records}
        (folder/'mac-portable-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
        note=(ROOT/'scripts/mac-portable-readme.txt').read_text(encoding='utf-8').replace('vVERSION','v'+version)
        (folder/'LEIA-ME.txt').write_text(note,encoding='utf-8')
        candidate=stage/output.name;packed={}
        with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as archive:
            for item,relative,mode,link in entries(folder/'GoStreams.app'):
                name='Mac-Portable/GoStreams.app/'+relative+('/' if stat.S_ISDIR(mode) else '')
                info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=mode<<16
                if stat.S_ISDIR(mode):info.external_attr|=0x10
                info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,b'' if stat.S_ISDIR(mode) else link if link is not None else item.read_bytes());packed[name]=(item,mode,link)
            for name in ['LEIA-ME.txt','mac-portable-manifest.json']:
                item=folder/name;info=zipfile.ZipInfo('Mac-Portable/'+name);info.create_system=3;info.external_attr=(stat.S_IFREG|0o644)<<16;info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,item.read_bytes());packed[info.filename]=(item,stat.S_IFREG|0o644,None)
        with zipfile.ZipFile(candidate) as archive:
            if archive.testzip() is not None:raise ValueError('ZIP CRC failure')
            if set(archive.namelist())!=set(packed):raise ValueError('ZIP entry mismatch')
            for name,(item,mode,link) in packed.items():
                if archive.getinfo(name).external_attr>>16!=mode:raise ValueError('Lost Unix permissions: '+name)
                if stat.S_ISDIR(mode):continue
                with archive.open(name) as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
                expected=hashlib.sha256(link).hexdigest() if link is not None else digest(item)
                if actual!=expected:raise ValueError('ZIP content mismatch: '+name)
        result={'version':version,'folder':str(destination),'archive':str(output),'sha256':digest(candidate),'archiveBytes':candidate.stat().st_size,'appFilesVerified':len(records),'executableFiles':sum(int(int(r['mode'],8)&0o111!=0) for r in records),'symlinks':sum(r['kind']=='symlink' for r in records),'originalResourcesPreserved':True,'zipModesAndBytesVerified':True,'nativeMacExecutionVerified':False,'builderMacExecutionVerified':False,'windowsReleaseModified':False}
        if destination.exists():
            if not destination.resolve().is_relative_to(release.resolve()) or destination.is_symlink():raise ValueError('Unsafe portable cleanup')
            shutil.rmtree(destination)
        folder.rename(destination);candidate.replace(output);report_path.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result),flush=True)
    finally:
        if not stage.is_relative_to(scratch_root.resolve()) or not stage.name.startswith('mac-portable-'):raise ValueError('Unsafe cleanup')
        shutil.rmtree(stage)

if __name__=='__main__':main()
