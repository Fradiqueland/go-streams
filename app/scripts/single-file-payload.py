"""Create the data-free, deterministic payload for the Windows single EXE."""
import hashlib,json,shutil,sys,xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text('utf8'))['version']
release=root/'release'/('GoStreams-'+version)
target=Path(sys.argv[1]).resolve();target.mkdir(parents=True,exist_ok=True)
files=[]
for folder in ['src','public','runtime','vendor']:
    for file in sorted((release/folder).rglob('*')):
        if file.is_symlink():raise ValueError('Windows single-file payload cannot contain links')
        if file.is_file():files.append(file)
for name in ['package.json','README.md']:files.append(release/name)
for folder in ['src','public']:
    for file in (root/folder).rglob('*'):
        if file.is_file() and (release/file.relative_to(root)).read_bytes()!=file.read_bytes():raise ValueError('Stale portable build')
if json.loads((release/'package.json').read_text('utf8'))['version']!=version:raise ValueError('Stale version')
required=['src/server.mjs','runtime/win32-x64/node.exe','runtime/win32-x64/ffmpeg.exe','runtime/win32-x64/ffprobe.exe','vendor/yt-dlp/win32/yt-dlp.exe']
names={f.relative_to(release).as_posix() for f in files}
if not set(required)<=names:raise ValueError('Incomplete portable dependencies')
if any(x.startswith(('data/','.tmp/')) for x in names):raise ValueError('Private data in payload')
archive_path=target/'payload.zip'; entries=[]
with ZipFile(archive_path,'w',compression=ZIP_DEFLATED,compresslevel=6) as archive:
    for file in files:
        name=file.relative_to(release).as_posix()
        with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        entries.append({'path':name,'bytes':str(file.stat().st_size),'sha256':digest})
        info=ZipInfo(name,(2020,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=ZIP_DEFLATED
        with file.open('rb') as source,archive.open(info,'w',force_zip64=True) as output:shutil.copyfileobj(source,output,1024*1024)
with archive_path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
manifest=ET.Element('bundle',schema='1',version=version,sha256=digest)
for entry in entries:ET.SubElement(manifest,'file',entry)
ET.ElementTree(manifest).write(target/'manifest.xml',encoding='utf-8',xml_declaration=True)
with ZipFile(archive_path) as archive:
    if archive.testzip() is not None:raise ValueError('Invalid archive CRC')
print(json.dumps({'files':len(entries),'archiveBytes':archive_path.stat().st_size,'extractedBytes':sum(int(x['bytes']) for x in entries),'sha256':digest}))
