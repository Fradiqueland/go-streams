import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {inspectMachO} from './macho.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=path.join(root,'scripts','mac-launcher','main.go');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function requireMacLauncher(base){
 const directory=path.join(base,'vendor','mac-launcher'),file=path.join(directory,'GoStreams'),metadata=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8')),bytes=fs.readFileSync(file);
 if(bytes.length!==metadata.bytes||hash(bytes)!==metadata.sha256)throw Error('Mac launcher integrity mismatch');
 const slices=inspectMachO(bytes);if(!['x64','arm64'].every(arch=>slices.some(s=>s.arch===arch)))throw Error('Mac launcher requires Intel and Apple Silicon');
 return file;
}
export function buildLauncher(){
 const go=process.env.GO_STREAMS_GO||'go',scratch=path.join(root,'.tmp','mac-launcher'),destination=path.join(root,'vendor','mac-launcher');fs.mkdirSync(scratch,{recursive:true});fs.mkdirSync(destination,{recursive:true});
 const env={...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',GOCACHE:path.join(scratch,'gocache'),CGO_ENABLED:'0'};
 const run=(args,more={})=>{const result=spawnSync(go,args,{cwd:path.dirname(source),env:{...env,...more},encoding:'utf8',windowsHide:true,timeout:180000});if(result.status!==0)throw Error(result.error?.message||result.stderr||result.stdout||'Mac launcher build failed');return result.stdout;};
 run(['test','-v','main.go','main_test.go']);
 const slices=[];
 for(const [cpu,arch]of [['amd64','x64'],['arm64','arm64']]){const file=path.join(scratch,'GoStreams-'+arch);run(['build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',file,'main.go'],{GOOS:'darwin',GOARCH:cpu});const bytes=fs.readFileSync(file);if(inspectMachO(bytes)[0].arch!==arch)throw Error('Incorrect launcher architecture');slices.push(bytes);}
 const align=16384,offsets=[align,Math.ceil((align+slices[0].length)/align)*align],output=Buffer.alloc(offsets[1]+slices[1].length);output.writeUInt32BE(0xcafebabe);output.writeUInt32BE(2,4);
 slices.forEach((bytes,index)=>{const p=8+20*index;output.writeUInt32BE(index?0x100000c:0x1000007,p);output.writeUInt32BE(bytes.readUInt32LE(8),p+4);output.writeUInt32BE(offsets[index],p+8);output.writeUInt32BE(bytes.length,p+12);output.writeUInt32BE(14,p+16);bytes.copy(output,offsets[index]);});
 fs.writeFileSync(path.join(destination,'GoStreams'),output,{mode:0o755});fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({bytes:output.length,sha256:hash(output),architectures:['x64','arm64'],sourceSha256:hash(fs.readFileSync(source)),toolchain:run(['version']).trim(),macExecutionVerified:false},null,2)+'\n');
 console.log(JSON.stringify({file:requireMacLauncher(root),bytes:output.length,architectures:['x64','arm64'],nativeExecutionVerified:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildLauncher();
