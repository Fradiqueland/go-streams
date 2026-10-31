import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {Store,Studio,Vault,runProcess} from '../src/core.mjs';

function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'core-isolation-')),children=[];
 const store=new Store(directory),studio=new Studio(store,new Vault(directory,{portable:true}),{spawnProcess(){
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,done){done();setImmediate(()=>child.emit('close',0));}});
  child.kill=()=>child.emit('close',null);children.push(child);return child;
 }});
 studio.probeMedia=async media=>media;
 store.update(data=>data.media.push({id:'clip',title:'Local clip',path:path.join(directory,'clip.mp4'),duration:4,width:320,height:180,fps:30,codec:'h264',audio:null}));
 const channel=studio.saveChannel({name:'Local channel',url:'rtmp://127.0.0.1:9/live',key:'test-secret'});
 t.after(async()=>{for(const child of children)child.emit('close',0);await studio.shutdown();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 return {store,studio,channel,children};
}

for(const scenario of ['missed','error'])test('a failed '+scenario+' schedule history write still reports its status and processes the next due schedule',async t=>{
 const {store,studio,channel,children}=fixture(t),time=Date.now(),reported=[];
 store.update(data=>{data.schedules=[
  {id:'first',mediaId:scenario==='error'?'missing':'clip',channelIds:[channel],status:'pending',armed:true,at:new Date(time-(scenario==='missed'?120000:1000)).toISOString()},
  {id:'second',mediaId:'clip',channelIds:[channel],status:'pending',armed:true,at:new Date(time-500).toISOString()}
 ];});
 studio.onScheduleStatus=details=>reported.push(details);
 const rename=fs.renameSync;let failed=false;
 t.mock.method(fs,'renameSync',(source,destination)=>{
  if(destination===store.file&&!failed&&JSON.parse(fs.readFileSync(source,'utf8')).history.some(item=>item.kind==='schedule')){failed=true;throw Error('Controlled history write failure');}
  return rename(source,destination);
 });
 await studio.tick(time);
 assert.equal(failed,true);assert.equal(store.data.schedules[0].status,scenario);
 assert.equal(store.data.schedules[1].status,'triggered');assert.equal(children.length,1);
 assert.equal(reported.length,1);assert.equal(reported[0].scheduleId,'first');assert.equal(reported[0].result,scenario);
 assert.equal(store.data.history.some(item=>item.kind==='schedule'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(store.data)),new Store(store.directory).data);
});

for(const phase of ['save','conversion'])test('failed local import '+phase+' removes only thumbnails for uncommitted media',async t=>{
 const {store,studio}=fixture(t),video=path.join(store.directory,'original.avi');
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=15','-t','0.2','-c:v','mpeg4','-y',video]);
 const original=fs.readFileSync(video),before=fs.readFileSync(store.file,'utf8');
 studio.runMediaProcess=async(command,args)=>fs.writeFileSync(args.at(-1),'local thumbnail');
 if(phase==='save'){
  const rename=fs.renameSync;let failed=false;
  t.mock.method(fs,'renameSync',(source,destination)=>{
   if(destination===store.file&&!failed&&JSON.parse(fs.readFileSync(source,'utf8')).media.some(item=>item.path===video)){failed=true;throw Error('Controlled media write failure');}
   return rename(source,destination);
  });
 }else studio.convertMedia=async()=>{throw Error('Controlled conversion failure');};
 const result=await studio.importMedia([video],{convert:phase==='conversion'});
 assert.equal(result.errors.length,1);assert.equal(result.imported.length,0);assert.deepEqual(fs.readFileSync(video),original);
 assert.equal(fs.readdirSync(path.join(store.directory,'thumbs')).length,phase==='save'?0:1);
 assert.equal(store.data.media.some(item=>item.path===video),phase==='conversion');
 if(phase==='save')assert.equal(fs.readFileSync(store.file,'utf8'),before);
});
