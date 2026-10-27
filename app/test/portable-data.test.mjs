import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Store,Studio,Vault} from '../src/core.mjs';
import {Downloads} from '../src/downloads.mjs';

function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'portable-data-'));
 t.after(()=>{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('portable-data-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});return root;
}
const metadata={duration:10,width:320,height:180,fps:30,size:3,codec:'h264',audio:null};
function file(root,relative,contents='abc'){const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,contents);return target;}

test('moving the portable data folder reconnects downloaded and converted videos without copying external originals',t=>{
 const root=fixture(t),source=path.join(root,'Original data'),destination=path.join(root,'Moved data'),store=new Store(source);
 const original=file(root,'external/original.mp4');
 const relative=['downloads/download-1/video.mp4','converted/converted-1.mp4','normalized/normalized-1.mp4'];
 store.update(s=>{s.media=[{...metadata,id:'external',title:'Original',path:original},...relative.map((r,i)=>({...metadata,id:'m'+i,title:'Managed',path:file(source,r)}))];s.downloads=[{id:'download-1',path:s.media[1].path,status:'completed'}];s.playlists=[{id:'list',name:'Order',mediaIds:['m0','external','m1','m2','m0']}];});
 // Both absolute paths are resolved and constrained to this test's owned folder before moving.
 assert.ok(source.startsWith(root+path.sep)&&destination.startsWith(root+path.sep));fs.renameSync(source,destination);
 const reopened=new Store(destination);
 assert.equal(reopened.data.media[0].path,original);assert.equal(reopened.data.media[0].managedPath,undefined);
 for(let i=0;i<relative.length;i++){assert.equal(reopened.data.media[i+1].path,path.join(destination,relative[i]));assert.equal(fs.readFileSync(reopened.data.media[i+1].path,'utf8'),'abc');}
 const studio={store:reopened},downloads=new Downloads(studio);assert.equal(downloads.file('download-1'),path.join(destination,relative[0]));
 assert.deepEqual(reopened.data.playlists,store.data.playlists);assert.equal(fs.readFileSync(original,'utf8'),'abc');
 assert.equal(new Store(destination).data.media[1].path,path.join(destination,relative[0]));
});

test('legacy files acquire portable references while external files and HTTPS sources stay untouched',t=>{
 const root=fixture(t),store=new Store(path.join(root,'data'));
 const internal=file(store.directory,'downloads/legacy/video.mp4'),external=file(root,'outside/converted/movie.mp4');
 const data={...store.data,media:[{...metadata,id:'one',path:internal},{...metadata,id:'two',path:external},{...metadata,id:'remote',source:'https',path:'https://example.test/video.mp4'}],downloads:[{id:'legacy',status:'completed',path:internal}]};
 fs.writeFileSync(store.file,JSON.stringify(data));const reopened=new Store(store.directory);
 assert.equal(reopened.data.media[0].managedPath,'downloads/legacy/video.mp4');assert.equal(reopened.data.downloads[0].managedPath,'downloads/legacy/video.mp4');
 assert.deepEqual(reopened.data.media.slice(1),data.media.slice(1));
});

test('invalid portable references cannot redirect a video outside the data directory',t=>{
 const root=fixture(t),store=new Store(path.join(root,'data')),external=file(root,'external.mp4');
 store.update(s=>{s.media=['../external.mp4','converted/../../external.mp4','/external.mp4','downloads/x/other.mp4'].map((managedPath,i)=>({...metadata,id:'m'+i,path:external,managedPath}));});
 const reopened=new Store(store.directory);assert.ok(reopened.data.media.every(m=>m.path===external));
});

test('project import keeps distinct case-sensitive media paths and their playlist order',async t=>{
 const root=fixture(t),store=new Store(path.join(root,'data')),studio=new Studio(store,new Vault(store.directory,{portable:true}));t.after(()=>studio.shutdown());
 // Model a case-sensitive macOS volume; native filesystem/probing is tested separately.
 studio.probeMedia=async m=>({...metadata,path:m.path});
 const input={version:1,media:[{id:'upper',title:'Upper',path:'/Volumes/CaseSensitive/Clip.mp4'},{id:'lower',title:'Lower',path:'/Volumes/CaseSensitive/clip.mp4'}],channels:[],schedules:[],playlists:[{id:'list',name:'Both files',mediaIds:['upper','lower','upper']}]};
 const result=await studio.importProject(input);assert.equal(result.media,2);assert.equal(store.data.media.length,2);
 const [upper,lower]=store.data.media;assert.deepEqual(store.data.playlists[0].mediaIds,[upper.id,lower.id,upper.id]);
});


import {sameLocalFile} from '../src/media-paths.mjs';
test('file identity respects real files on case-sensitive and case-insensitive volumes',()=>{
 const a='/Volumes/Data/Clip.mp4',b='/Volumes/Data/clip.mp4';
 assert.equal(sameLocalFile(a,b,{realpath:p=>p,stat:p=>({dev:1,ino:p===a?1:2})}),false);
 assert.equal(sameLocalFile(a,b,{realpath:p=>p,stat:()=>({dev:1,ino:7})}),true);
 assert.equal(sameLocalFile(a,b,{realpath:()=>a,stat:()=>{throw Error('unneeded');}}),true);
 assert.equal(sameLocalFile(a,b,{realpath:()=>{throw Error('missing');}}),false);
});

test('portable relocation uses the current copy even when the old copy still exists',t=>{
 const root=fixture(t),source=new Store(path.join(root,'original')),destination=path.join(root,'copy');
 const original=file(source.directory,'converted/video.mp4');source.update(s=>s.media=[{...metadata,id:'m',path:original}]);
 fs.cpSync(source.directory,destination,{recursive:true});const copied=new Store(destination);
 assert.equal(copied.data.media[0].path,path.join(destination,'converted/video.mp4'));assert.ok(fs.existsSync(original));
 assert.equal(new Store(source.directory).data.media[0].path,original);
});

test('missing managed files retain their references and can reconnect after a later copy',t=>{
 const root=fixture(t),store=new Store(path.join(root,'data')),old=path.join(root,'old','converted','missing.mp4');
 store.update(s=>s.media=[{...metadata,id:'m',path:old,managedPath:'converted/missing.mp4'}]);
 assert.equal(new Store(store.directory).data.media[0].path,old);
 const recovered=file(store.directory,'converted/missing.mp4');assert.equal(new Store(store.directory).data.media[0].path,recovered);
});


test('a simulated directory link resolving outside the data folder cannot relocate a missing reference',t=>{
 const root=fixture(t),store=new Store(path.join(root,'data')),external=path.join(root,'outside');const outside=file(external,'video.mp4');
 const linked=file(store.directory,'converted/video.mp4'),realpath=fs.realpathSync;
 // Model the resolved target of a junction without requiring link-creation privileges.
 t.mock.method(fs,'realpathSync',(value,...args)=>path.resolve(value)===linked?outside:realpath(value,...args));
 const missing=path.join(root,'old','converted','video.mp4');store.update(s=>s.media=[{...metadata,id:'m',path:missing,managedPath:'converted/video.mp4'}]);
 assert.equal(new Store(store.directory).data.media[0].path,missing);assert.equal(fs.readFileSync(path.join(external,'video.mp4'),'utf8'),'abc');
});
