import {requireMacLauncher} from './build-mac-launcher.mjs';
import {macRequirements} from './macho.mjs';
import {requireRuntime,copyRuntime,runtimeTargets} from './vendor-runtime.mjs';
import {requireYtdlp,copyYtdlp} from './vendor-ytdlp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function buildMac(root){
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid version');
  requireYtdlp(root,'darwin');
  for(const target of runtimeTargets('darwin'))requireRuntime(root,target);
  const entries=runtimeTargets('darwin').flatMap(target=>['node','ffmpeg','ffprobe'].map(name=>({file:path.join(root,'vendor','runtime',target,name),arches:[target.slice(7)]})));
  entries.push({file:path.join(root,'vendor','yt-dlp','darwin','yt-dlp'),arches:['x64','arm64']});
  const launcherFile=requireMacLauncher(root);entries.push({file:launcherFile,arches:['x64','arm64']});
  const minimum=macRequirements(entries);
  const bundle=path.join(root,'release',`GoStreams-${version}-mac`,'GoStreams.app');
  const contents=path.join(bundle,'Contents'),resources=path.join(contents,'Resources'),app=path.join(resources,'app'),macos=path.join(contents,'MacOS');
  fs.mkdirSync(app,{recursive:true});fs.mkdirSync(macos,{recursive:true});
  for(const folder of ['src','public'])fs.cpSync(path.join(root,folder),path.join(app,folder),{recursive:true});
  for(const name of ['package.json','README.md'])fs.copyFileSync(path.join(root,name),path.join(app,name));
  copyYtdlp(root,app,'darwin');copyRuntime(root,app,'darwin');
  fs.copyFileSync(path.join(root,'public','icon.icns'),path.join(resources,'GoStreams.icns'));
  fs.copyFileSync(launcherFile,path.join(macos,'GoStreams'));fs.chmodSync(path.join(macos,'GoStreams'),0o755);
  for(const name of ['LICENSE','PATENTS'])fs.copyFileSync(path.join(root,'vendor','mac-launcher',name),path.join(resources,'Go-'+name+'.txt'));
  fs.writeFileSync(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>GoStreams</string>
<key>CFBundleIdentifier</key><string>net.gostreams.desktop</string>
<key>CFBundleName</key><string>Go Streams</string>
<key>CFBundleIconFile</key><string>GoStreams.icns</string>
<key>CFBundleDisplayName</key><string>Go Streams</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>${minimum}</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>\n`);
  return bundle;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(buildMac(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')));
