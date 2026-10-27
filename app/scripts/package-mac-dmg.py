"""Create one Mac DMG from the verified Mac ZIP; never alters Windows releases.

The writer is built from the pinned JetBrains module plus mac-dmg-*.go adapters.
Build-only dependencies are not installed on the end user's Mac.
"""
from pathlib import Path
import argparse, importlib.util, json, shutil, subprocess, tempfile, zipfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--writer', type=Path, default=ROOT / '.tmp/mac-dmg-toolchain/gostreams-dmg.exe')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    source = ROOT / 'release' / f'GoStreams-v{version}-Mac.zip'
    output = ROOT / 'release' / f'GoStreams-v{version}-Mac.dmg'
    report = ROOT / 'release' / f'GoStreams-v{version}-Mac-dmg-verification.json'
    if output.exists():
        raise FileExistsError(f'Preserve the existing image: {output}')
    if not args.writer.is_file() or not source.is_file():
        raise FileNotFoundError('Prepare the Mac ZIP and the pinned DMG writer first.')
    scratch_root = ROOT / '.tmp'
    scratch_root.mkdir(exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix='mac-dmg-', dir=scratch_root)).resolve()
    if not scratch.is_relative_to(scratch_root.resolve()) or not scratch.name.startswith('mac-dmg-'):
        raise RuntimeError('Unsafe packaging directory')
    candidate = scratch / output.name
    try:
        payload = scratch / 'payload.zip'
        prefix = 'GoStreams-Mac/'
        app_prefix = prefix + 'GoStreams.app/'
        with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as outgoing:
            members = [item for item in incoming.infolist() if item.filename.startswith(app_prefix)]
            if not members:
                raise ValueError('The source archive contains no GoStreams.app')
            for item in members:
                name = item.filename[len(prefix):]
                if any(part in ('.', '..') for part in Path(name).parts) or '\\' in name or ':' in name:
                    raise ValueError('Unsafe archive path')
                record = zipfile.ZipInfo(name, date_time=item.date_time)
                record.create_system = 3
                record.external_attr = item.external_attr
                record.compress_type = zipfile.ZIP_DEFLATED
                outgoing.writestr(record, incoming.read(item))
        subprocess.run([str(args.writer.resolve()), str(payload), str(candidate), str(scratch)], check=True)
        spec = importlib.util.spec_from_file_location('verify_mac_dmg', ROOT / 'scripts/verify-mac-dmg.py')
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        staged_report = scratch / 'verification.json'
        result = verifier.validate(candidate, payload, staged_report)
        result['path'] = str(output)
        result['sourceArchive'] = source.name
        candidate.rename(output)
        report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'path':str(output),'bytes':output.stat().st_size,'verified':True,'executionVerified':False}), flush=True)
    finally:
        if not scratch.is_relative_to(scratch_root.resolve()) or not scratch.name.startswith('mac-dmg-'):
            raise RuntimeError('Unsafe packaging cleanup')
        shutil.rmtree(scratch)

if __name__ == '__main__':
    main()
