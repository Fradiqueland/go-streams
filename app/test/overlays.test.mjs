import {prepareOverlays} from '../src/overlays.mjs';
import {overlayPreview,styleOverlayPreview} from '../public/overlays-ui.js';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {createApplication} from '../src/server.mjs';
import {runProcess,probe} from '../src/core.mjs';
import {overlayDefaults,validateOverlays} from '../src/overlays.mjs';
import {exportBackup,decryptBackup,prepareBackupRestore} from '../src/backups.mjs';
import {dispatch} from './transport.mjs';import {uiHarness} from './ui-harness.mjs';
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'overlays-'));
let red,green,gif;const video=path.join(root,'source.mp4'),apps=[];
before(async()=>{
 for(const [name,color]of [['red','red'],['green','lime']])await runProcess('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=160x56`,'-frames:v','1','-y',path.join(root,name+'.png')]);
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=32x32:r=2','-t','1','-y',path.join(root,'image.gif')]);
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=320x180:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2.5','-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',video]);
 red='data:image/png;base64,'+fs.readFileSync(path.join(root,'red.png')).toString('base64');green='data:image/png;base64,'+fs.readFileSync(path.join(root,'green.png')).toString('base64');gif='data:image/gif;base64,'+fs.readFileSync(path.join(root,'image.gif')).toString('base64');
});
after(async()=>{for(const app of apps)await app.close();if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('overlays-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
async function make(){const app=await createApplication({directory:fs.mkdtempSync(path.join(root,'data-')),listen:false,clock:false,portableVault:true});apps.push(app);return app;}
const req=(app,url,body,method='PUT')=>dispatch(app,url,{method,headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const config=()=>({top:{...overlayDefaults.top,enabled:true,text:'António 🎵 你好',speed:300,opacity:1,data:red},bottom:{...overlayDefaults.bottom,enabled:true,text:'Music ❤️',speed:300,direction:'right',opacity:1,data:green},image:{...overlayDefaults.image,enabled:true,width:20,x:50,y:50,data:gif}});

test('overlay settings store small immutable assets and require authentication',async()=>{
 const app=await make(),result=await req(app,'/api/settings',{overlays:config()});assert.equal(result.status,200,await result.text());
 const saved=app.store.data.settings.overlays;assert.equal(saved.top.text,'António 🎵 你好');assert.ok(!JSON.stringify(saved).includes('base64'));
 const asset='/api/overlays/'+saved.image.asset;assert.equal((await dispatch(app,asset)).status,401);const image=await req(app,asset,undefined,'GET');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/gif');assert.deepEqual(image.body,fs.readFileSync(path.join(root,'image.gif')));
 assert.equal((await dispatch(app,'/api/settings',{method:'PUT',body:'{}',headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json'}})).status,403);
});

test('overlay validation rejects invalid colors, filters, paths, formats and oversized payloads',()=>{
 for(const mutate of [c=>c.top.color="red;movie=http://example.test",c=>c.top.speed=-1,c=>c.image.asset='../../x.png',c=>c.top.direction='bad',c=>c.top.data='data:image/jpeg;base64,'+Buffer.from('not an image').toString('base64'),c=>c.image.data='data:image/png;base64,'+Buffer.alloc(3*1024*1024).toString('base64')]){const c=config();mutate(c);assert.throws(()=>validateOverlays(c));}
});

test('invalid raster data does not replace previously saved overlay settings',async()=>{
 const app=await make();assert.equal((await req(app,'/api/settings',{overlays:config()})).status,200);const before=structuredClone(app.store.data.settings);
 const c=config();c.image.data='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(40)]).toString('base64');
 assert.equal((await req(app,'/api/settings',{overlays:c})).status,400);assert.deepEqual(app.store.data.settings,before);
});

test('real FFmpeg composes two moving banners and a looping GIF without editing the source',{timeout:30000},async()=>{
 const app=await make();assert.equal((await req(app,'/api/settings',{overlays:config(),encoding:{copy:true}})).status,200);
 const original=crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex');const imported=await app.studio.importMedia([video]);
 const [started]=await app.studio.start({mediaId:imported.imported[0],preview:true});const job=app.studio.jobs.get(started.id);await job.completion;assert.equal(job.status,'completed',job.error);assert.equal(job.encoding.copy,false);
 const output=path.join(app.store.directory,'previews',job.output),info=await probe(output,'ffprobe');assert.equal(info.width,1280);assert.equal(info.height,720);assert.ok(info.duration>2.3);assert.equal(info.audio.codec,'aac');

 // Decode through a file to avoid converting binary pixels into a UTF-8 string.
 const rgb=path.join(root,'frame.rgb');await runProcess('ffmpeg',['-v','error','-ss','1','-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',rgb]);const bytes=fs.readFileSync(rgb),at=(x,y)=>[...bytes.subarray((y*1280+x)*3,(y*1280+x)*3+3)];
 const top=at(1030,20),bottom=at(180,700);assert.ok(top[0]>180&&top[1]<80,JSON.stringify(top));assert.ok(bottom[1]>180&&bottom[0]<80,JSON.stringify(bottom));
 const region=async time=>(await runProcess('ffmpeg',['-v','error','-ss',time,'-i',output,'-vf','crop=100:100:590:310','-frames:v','1','-f','md5','-'])).stdout;
 assert.notEqual(await region('0.2'),await region('0.7'));assert.equal(crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex'),original);
});

test('encrypted backup carries overlay images into a fresh data directory',async()=>{
 const source=await make(),target=await make();assert.equal((await req(source,'/api/settings',{overlays:config()})).status,200);
 const pass='Overlay-backup-password',backup=await exportBackup(source.store,source.studio.vault,{scope:'settings',password:pass,interface:{language:'en',layout:'list',compact:false}});
 const restored=prepareBackupRestore(await decryptBackup(backup,pass),target.store.data,target.studio.vault,target.store.directory);target.store.update(s=>Object.assign(s,restored.data));assert.deepEqual(target.store.data.settings.overlays,source.store.data.settings.overlays);
 const asset=await req(target,'/api/overlays/'+target.store.data.settings.overlays.top.asset,undefined,'GET');assert.equal(asset.status,200);assert.deepEqual(asset.body,fs.readFileSync(path.join(root,'red.png')));
});

test('production overlay editor saves text, emojis and image selections through the API',async()=>{
 const app=await make(),h=uiHarness({fetch:(url,init={})=>dispatch(app,url,{...init,headers:{Cookie:'go_streams='+app.token,...init.headers}})});await h.run('refresh(false)');
 h.context.renderBanner=async()=>red;h.context.imageData=async()=>gif;await h.click('overlays');assert.ok(h.element('#dialog-content').innerHTML.includes('Banner superior'));assert.ok(h.element('#dialog-content').innerHTML.includes('data-overlay-preview'));
 await h.submit({topEnabled:true,topText:'Olá 🎵',topFont:32,topSpeed:100,topDirection:'left',topColor:'#ffffff',topBackground:'#000000',topOpacity:.65,bottomEnabled:false,bottomText:'',bottomFont:32,bottomSpeed:100,bottomDirection:'left',bottomColor:'#ffffff',bottomBackground:'#000000',bottomOpacity:.65,imageEnabled:true,imageWidth:15,imageX:90,imageY:20,imageOpacity:1,overlayImage:{size:100}});
 assert.equal(app.store.data.settings.overlays.top.text,'Olá 🎵');assert.equal(app.store.data.settings.overlays.image.enabled,true);
});


test('a silent source gets AAC audio and a static PNG overlay using the correct input indexes',{timeout:30000},async()=>{
 const app=await make(),silent=path.join(root,'silent.mp4');await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=160x90:r=25','-t','0.8','-c:v','libx264','-preset','ultrafast','-y',silent]);
 const c=structuredClone(overlayDefaults);c.image={...c.image,enabled:true,data:red};assert.equal((await req(app,'/api/settings',{overlays:c})).status,200);
 const imported=await app.studio.importMedia([silent]);const [started]=await app.studio.start({mediaId:imported.imported[0],preview:true});const job=app.studio.jobs.get(started.id);await job.completion;assert.equal(job.status,'completed',job.error);
 const result=await probe(path.join(app.store.directory,'previews',job.output),'ffprobe');assert.equal(result.audio.codec,'aac');assert.ok(result.duration>=.75&&result.duration<1.5);
});


for(const ext of ['jpg','webp'])test('static '+ext+' overlay assets are accepted without retaining the upload payload',async()=>{
 const app=await make(),file=path.join(root,'image.'+ext);await runProcess('ffmpeg',['-v','error','-i',path.join(root,'red.png'),'-frames:v','1','-y',file]);
 const c=structuredClone(overlayDefaults);c.image={...c.image,enabled:true,data:'data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+fs.readFileSync(file).toString('base64')};
 const result=await req(app,'/api/settings',{overlays:c});assert.equal(result.status,200,await result.text());assert.ok(app.store.data.settings.overlays.image.asset.endsWith('.'+ext));
});

test('changing saved overlays leaves the running session and its resumed image unchanged',async()=>{
 const app=await make();assert.equal((await req(app,'/api/settings',{overlays:config()})).status,200);const saved=structuredClone(app.store.data.settings.overlays),children=[],commands=[];
 app.studio.spawnProcess=(command,args)=>{commands.push(args);const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new Writable({write(chunk,encoding,done){done();setImmediate(()=>c.emit('close',0));}});c.kill=()=>setImmediate(()=>c.emit('close',null));children.push(c);return c;};
 const imported=await app.studio.importMedia([video]),channel=app.studio.saveChannel({name:'Offline target',url:'rtmp://127.0.0.1:9/live',key:'LOCAL-ONLY'});
 const [started]=await app.studio.start({mediaId:imported.imported[0],channelIds:[channel],confirmed:true});assert.equal(commands.length,1);
 assert.equal((await req(app,'/api/settings',{overlays:overlayDefaults})).status,200);assert.equal(commands.length,1);assert.deepEqual(app.studio.contexts.get(started.id).overlays,saved);
 app.studio.pause(started.id);await new Promise(resolve=>setImmediate(resolve));app.studio.resume(started.id,true);assert.equal(commands.length,2);assert.ok(commands[1].some(arg=>arg.endsWith(saved.image.asset)));
 app.studio.stop(started.id);await app.studio.jobs.get(started.id).completion;
});

test('overlay configuration is reachable from settings and the preparation screen in English',()=>{
 const h=uiHarness({locale:'en'});for(const name of ['settings','golive']){h.run('page='+JSON.stringify(name)+';draw()');assert.ok(h.element('#content').innerHTML.includes('data-action="overlays"'));}
});


test('overlay preview uses CSS properties compatible with the strict stylesheet policy',()=>{
 const c=config(),span={style:{}},bar={style:{},querySelector:()=>span},image={style:{}},preview={querySelector:selector=>selector==='img'?image:bar};
 const html=overlayPreview(c,'/api/overlays/example.png',value=>String(value).replaceAll('<','&lt;'));assert.ok(!html.includes('style='));styleOverlayPreview(preview,c);assert.equal(image.style.width,'20%');assert.equal(span.style.animationDirection,'reverse');assert.ok(Number.parseFloat(bar.style.height)>0);
});


test('missing overlay assets can be disabled without uploading replacement images',async()=>{
 const app=await make();assert.equal((await req(app,'/api/settings',{overlays:config()})).status,200);const saved=structuredClone(app.store.data.settings.overlays);
 for(const key of ['top','bottom','image']){saved[key].enabled=false;const file=path.join(app.store.directory,'overlays',saved[key].asset);if(fs.existsSync(file))fs.unlinkSync(file);}
 const result=await req(app,'/api/settings',{overlays:saved});assert.equal(result.status,200,await result.text());assert.ok(['top','bottom','image'].every(key=>!app.store.data.settings.overlays[key].enabled&&!app.store.data.settings.overlays[key].asset));
});

test('a rejected overlay image leaves neither permanent assets nor temporary folders behind',async()=>{
 const app=await make(),before=structuredClone(app.store.data.settings),c=config();c.image.data='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(50)]).toString('base64');
 assert.equal((await req(app,'/api/settings',{overlays:c})).status,400);assert.deepEqual(app.store.data.settings,before);assert.ok(!fs.existsSync(path.join(app.store.directory,'overlays'))||fs.readdirSync(path.join(app.store.directory,'overlays')).length===0);assert.ok(!fs.readdirSync(app.store.directory).some(name=>name.startsWith('overlays-stage-')));
});

test('a disabled corrupt asset does not prevent saving an overlay-free configuration',async()=>{
 const app=await make();assert.equal((await req(app,'/api/settings',{overlays:config()})).status,200);const saved=structuredClone(app.store.data.settings.overlays);
 for(const key of ['top','bottom','image']){saved[key].enabled=false;fs.writeFileSync(path.join(app.store.directory,'overlays',saved[key].asset),'corrupted');}
 const result=await req(app,'/api/settings',{overlays:saved});assert.equal(result.status,200,await result.text());assert.ok(['top','bottom','image'].every(key=>!app.store.data.settings.overlays[key].enabled));
});


test('cancelling overlay validation removes staged images without probing the remaining images',async()=>{
 const app=await make();let release,started,cancelled=false,calls=0;const gate=new Promise(resolve=>{release=resolve;}),reading=new Promise(resolve=>{started=resolve;});
 const pending=prepareOverlays(config(),app.store.directory,async()=>{calls++;started();await gate;return {stdout:JSON.stringify({streams:[{codec_type:'video',codec_name:'png',width:160,height:56}]})};},'controlled-probe',()=>cancelled);
 const outcome=pending.then(value=>({value}),error=>({error}));await reading;
 try{assert.ok(fs.readdirSync(app.store.directory).some(name=>name.startsWith('overlays-stage-')));cancelled=true;}finally{release();}
 assert.equal((await outcome).error.status,503);assert.equal(calls,1);assert.ok(!fs.existsSync(path.join(app.store.directory,'overlays')));assert.ok(!fs.readdirSync(app.store.directory).some(name=>name.startsWith('overlays-stage-')));
});

test('uploading the original image repairs a damaged stored asset with the same hash name',async()=>{
 const app=await make();assert.equal((await req(app,'/api/settings',{overlays:config()})).status,200);const asset=app.store.data.settings.overlays.image.asset,file=path.join(app.store.directory,'overlays',asset);fs.writeFileSync(file,'corrupted');
 const result=await req(app,'/api/settings',{overlays:config()});assert.equal(result.status,200,await result.text());assert.equal(app.store.data.settings.overlays.image.asset,asset);assert.deepEqual(fs.readFileSync(file),fs.readFileSync(path.join(root,'image.gif')));
});

test('turning all overlays off does not require an available image-probing executable',async()=>{
 const app=await make();assert.equal((await req(app,'/api/settings',{overlays:config()})).status,200);const saved=structuredClone(app.store.data.settings.overlays);for(const key of ['top','bottom','image'])saved[key].enabled=false;
 app.store.update(s=>s.settings.ffprobe=path.join(app.store.directory,'missing-ffprobe.exe'));const result=await req(app,'/api/settings',{overlays:saved});assert.equal(result.status,200,await result.text());
});


for(const kind of ['damaged','oversized'])test('backup restore rejects a '+kind+' overlay before replacing settings or retaining assets',async()=>{
 const source=await make(),target=await make();assert.equal((await req(target,'/api/settings',{overlays:config()})).status,200);
 const file=path.join(root,'backup-'+kind+'.png');
 if(kind==='damaged')fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(50)]));
 else await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=4098x2','-frames:v','1','-y',file]);
 const bytes=fs.readFileSync(file),asset=crypto.createHash('sha256').update(bytes).digest('hex')+'.png';
 fs.mkdirSync(path.join(source.store.directory,'overlays'),{recursive:true});fs.writeFileSync(path.join(source.store.directory,'overlays',asset),bytes);
 source.store.update(s=>{s.settings.overlays=structuredClone(overlayDefaults);s.settings.overlays.image={...s.settings.overlays.image,enabled:true,asset};});
 const pass='Restore-validation-password',backup=await exportBackup(source.store,source.studio.vault,{scope:'settings',password:pass,interface:{language:'en',layout:'list',compact:false}});
 const before=fs.readFileSync(target.store.file,'utf8'),files=fs.readdirSync(path.join(target.store.directory,'overlays')).sort();
 const response=await req(target,'/api/backups/restore',{backup,password:pass,confirmed:true},'POST');
 assert.equal(response.status,400,await response.text());assert.equal(fs.readFileSync(target.store.file,'utf8'),before);
 assert.deepEqual(fs.readdirSync(path.join(target.store.directory,'overlays')).sort(),files);assert.ok(!fs.readdirSync(target.store.directory).some(name=>name.startsWith('overlays-stage-')));
});

test('backup validation does not write inline image data before discovering invalid preferences',async()=>{
 const app=await make(),payload={version:1,scope:'settings',data:{settings:{overlays:config()}},interface:{language:'invalid',layout:'list',compact:false}};
 assert.throws(()=>prepareBackupRestore(payload,app.store.data,app.studio.vault,app.store.directory));
 assert.ok(!fs.existsSync(path.join(app.store.directory,'overlays'))||!fs.readdirSync(path.join(app.store.directory,'overlays')).length);
});


test('encrypted restore validates overlays with portable tools and repairs existing damaged images',async()=>{
 const source=await make(),target=await make();for(const app of [source,target])assert.equal((await req(app,'/api/settings',{overlays:config()})).status,200);
 source.store.update(s=>s.settings.ffprobe=path.join(source.store.directory,'unavailable-custom-ffprobe.exe'));
 const saved=structuredClone(source.store.data.settings),file=path.join(target.store.directory,'overlays',saved.overlays.image.asset);fs.writeFileSync(file,'damaged');
 const pass='Portable-restore-password',backup=await exportBackup(source.store,source.studio.vault,{scope:'settings',password:pass,interface:{language:'en',layout:'list',compact:false}});
 const response=await req(target,'/api/backups/restore',{backup,password:pass,confirmed:true},'POST');assert.equal(response.status,200,await response.text());assert.deepEqual(target.store.data.settings,saved);assert.deepEqual(fs.readFileSync(file),fs.readFileSync(path.join(root,'image.gif')));
});

test('restoring overlays blocks concurrent edits and closing cancels validation without replacing the project',async()=>{
 const source=await make(),target=await make();assert.equal((await req(source,'/api/settings',{overlays:config()})).status,200);
 const pass='Closing-restore-password',backup=await exportBackup(source.store,source.studio.vault,{scope:'settings',password:pass,interface:{language:'en',layout:'list',compact:false}}),before=fs.readFileSync(target.store.file,'utf8');
 let started;const validating=new Promise(resolve=>{started=resolve;}),add=target.studio.pendingImports.add.bind(target.studio.pendingImports);
 target.studio.pendingImports.add=value=>{const result=add(value);started();return result;};
 const pending=req(target,'/api/backups/restore',{backup,password:pass,confirmed:true},'POST');
 await validating;
 assert.equal((await req(target,'/api/settings',{encoding:{fps:60}})).status,409);
 assert.equal((await req(target,'/api/state',undefined,'GET')).status,200);
 assert.equal((await req(target,'/api/backups/restore',{backup,password:pass,confirmed:true},'POST')).status,409);
 await target.close();const response=await pending;assert.equal(response.status,503,await response.text());assert.equal(fs.readFileSync(target.store.file,'utf8'),before);
 assert.equal(target.studio.pendingImports.size,0);assert.ok(!fs.existsSync(path.join(target.store.directory,'overlays')));assert.ok(!fs.readdirSync(target.store.directory).some(name=>name.startsWith('overlays-stage-')));
});

test('export refuses an overlay whose stored bytes no longer match its immutable name',async()=>{
 const app=await make();assert.equal((await req(app,'/api/settings',{overlays:config()})).status,200);
 fs.writeFileSync(path.join(app.store.directory,'overlays',app.store.data.settings.overlays.image.asset),'damaged');
 const response=await req(app,'/api/backups/export',{scope:'settings',password:'Export-integrity-password',interface:{language:'en',layout:'list',compact:false}},'POST');assert.equal(response.status,400);assert.match((await response.json()).error,/missing or damaged/);
});
