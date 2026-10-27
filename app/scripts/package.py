"""Package the Windows build and source without user data or credentials."""
import json
import hashlib
import stat
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
release = root / 'release' / f'GoStreams-{version}'
destination = Path(sys.argv[1]).resolve()
destination.mkdir(parents=True, exist_ok=True)
platform = sys.argv[2] if len(sys.argv) > 2 else 'all'
if platform not in ('win32','darwin','all'):raise ValueError('Invalid platform')
suffix = {'win32':'-Windows','darwin':'-Mac','all':''}[platform]
output = destination / f'GoStreams-v{version}{suffix}.zip'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for base, prefix, folders, files in [
        (release, 'GoStreams', ['src', 'public', 'vendor', 'runtime'], ['GoStreams.exe', 'CloseGoStreams.cmd', 'package.json', 'README.md']),
        (root, 'source', ['src', 'public', 'scripts', 'test'], ['package.json', 'README.md', '.gitignore']),
    ]:
        if prefix == 'GoStreams' and platform == 'darwin':continue
        for folder in folders:
            for file in sorted((base / folder).rglob('*')):
                if file.is_file() and '__pycache__' not in file.parts:
                    archive.write(file, f'{prefix}/{file.relative_to(base).as_posix()}')
        for name in files:
            archive.write(base / name, f'{prefix}/{name}')
    archive.write(root / 'vendor' / 'yt-dlp' / 'manifest.json', 'source/vendor/yt-dlp/manifest.json')
    archive.write(root / 'vendor' / 'runtime' / 'downloads.json', 'source/vendor/runtime/downloads.json')
    mac_root = root / 'release' / f'GoStreams-{version}-mac'
    if platform in ('all','darwin') and not mac_root.is_dir():raise RuntimeError('Mac bundle is missing')
    for file in (sorted(mac_root.rglob('*')) if platform in ('all','darwin') else []):
        if file.is_file():
            relative = file.relative_to(mac_root).as_posix()
            info = ZipInfo('GoStreams-Mac/' + relative)
            info.create_system = 3
            info.external_attr = ((0o100755 if relative.endswith('/Contents/MacOS/GoStreams') or relative.endswith('/vendor/yt-dlp/darwin/yt-dlp') or ('/runtime/darwin-' in relative and file.name in ('node','ffmpeg','ffprobe')) else 0o100644) << 16)
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, file.read_bytes())
with ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Archive verification failed')
    names = archive.namelist()
    if len(names) != len(set(names)):
        raise RuntimeError('Duplicate package entries')
    prefixes = []
    if platform in ('win32', 'all'): prefixes.append(('GoStreams', ['win32-x64'], 'win32'))
    if platform in ('darwin', 'all'): prefixes.append(('GoStreams-Mac/GoStreams.app/Contents/Resources/app', ['darwin-x64', 'darwin-arm64'], 'darwin'))
    for prefix, targets, os_name in prefixes:
        if json.loads(archive.read(prefix + '/package.json'))['version'] != version:
            raise RuntimeError('Stale application version in package')
        if any(name.startswith(prefix + '/data/') or name.startswith(prefix + '/.tmp/') for name in names):
            raise RuntimeError('User data in package')
        for folder in ('src', 'public'):
            for file in (root / folder).rglob('*'):
                if file.is_file() and archive.read(prefix + '/' + file.relative_to(root).as_posix()) != file.read_bytes():
                    raise RuntimeError('Stale application file: ' + str(file))
        for target in targets:
            directory = prefix + '/runtime/' + target + '/'
            manifest = json.loads(archive.read(directory + 'manifest.json'))
            for entry in manifest['files']:
                member = directory + entry['name']
                with archive.open(member) as stream:
                    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                if archive.getinfo(member).file_size != entry['bytes'] or digest != entry['sha256']:
                    raise RuntimeError('Runtime integrity mismatch: ' + member)
                if os_name == 'darwin' and entry['name'] in ('node', 'ffmpeg', 'ffprobe') and stat.S_IMODE(archive.getinfo(member).external_attr >> 16) != 0o755:
                    raise RuntimeError('Missing Mac executable permission: ' + member)
        member = prefix + '/vendor/yt-dlp/' + os_name + '/yt-dlp' + ('.exe' if os_name == 'win32' else '')
        if member not in names: raise RuntimeError('Missing bundled downloader')
        if os_name == 'darwin':
            for executable in [member, 'GoStreams-Mac/GoStreams.app/Contents/MacOS/GoStreams']:
                if stat.S_IMODE(archive.getinfo(executable).external_attr >> 16) != 0o755:
                    raise RuntimeError('Missing Mac executable permission: ' + executable)
    print(json.dumps({'path': str(output), 'files': len(names), 'bytes': output.stat().st_size, 'verified': 'CRC, source parity, runtime hashes, Mac executable permissions'}))
