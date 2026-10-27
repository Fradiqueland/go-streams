import sys,tarfile,zipfile
from pathlib import Path
archive,destination,version,target=sys.argv[1:]
root=Path(destination).resolve();root.mkdir(parents=True,exist_ok=True)
prefix=f'node-v{version}-{target}/'
names={'LICENSE':'NODE-LICENSE.txt',('node.exe' if target=='win-x64' else 'bin/node'):('node.exe' if target=='win-x64' else 'node')}
if archive.endswith('.zip'):
 with zipfile.ZipFile(archive) as source:
  for name,output in names.items():(root/output).write_bytes(source.read(prefix+name))
else:
 with tarfile.open(archive,'r:gz') as source:
  for name,output in names.items():
   member=source.getmember(prefix+name)
   if not member.isfile() or member.size>150*1024*1024:raise ValueError('Invalid Node archive entry')
   (root/output).write_bytes(source.extractfile(member).read())
