import test,{before} from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {createApplication} from '../../src/server.mjs';import {runProcess,probe} from '../../src/core.mjs';
before(async()=>{
 const server=net.createServer(socket=>socket.end());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{await new Promise((resolve,reject)=>{const client=net.connect(server.address().port,'127.0.0.1');client.once('error',reject);client.once('connect',()=>{client.end();resolve();});});}
 finally{await new Promise(resolve=>server.close(resolve));}
});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(r=>s.close(r));return port;}
function temp(t){const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'wire-'));t.after(()=>{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('wire-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});return root;}
test('real HTTP socket authenticates the launcher, serves the app and rejects foreign origins',async t=>{
 const root=temp(t),app=await createApplication({directory:root,port:0,clock:false,portableVault:true});t.after(()=>app.close());
 const noCookie=await fetch(app.base+'/api/state');assert.equal(noCookie.status,401);
 const launch=await fetch(app.url,{redirect:'manual'});assert.equal(launch.status,303);const cookie=launch.headers.get('set-cookie').split(';')[0];
 const page=await fetch(app.base+'/',{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.ok((await page.text()).includes('GO <strong>STREAMS'));
 const state=await fetch(app.base+'/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);assert.deepEqual((await state.json()).jobs,[]);
 const rejected=await fetch(app.base+'/api/channels',{method:'POST',headers:{Cookie:cookie,Origin:'https://foreign.example','Content-Type':'application/json','X-Go-Streams':'1'},body:'{}'});assert.equal(rejected.status,403);
});
test('actual RTMP transport sends a playable stream to a loopback-only FFmpeg receiver',{timeout:30000},async t=>{
 const root=temp(t),video=path.join(root,'source.mp4'),received=path.join(root,'received.flv');
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-y',video]);
 const port=await freePort(),target=`rtmp://127.0.0.1:${port}/live/LOCAL-ONLY`;
 const receiver=spawn('ffmpeg',['-hide_banner','-loglevel','warning','-listen','1','-i',target,'-c','copy','-f','flv','-y',received],{windowsHide:true,shell:false,stdio:['pipe','ignore','pipe']});
 let stderr='';receiver.stderr.on('data',b=>{stderr+=b.toString();});receiver.stdin.on('error',()=>{});const receiverDone=new Promise((resolve,reject)=>{receiver.once('error',reject);receiver.once('close',resolve);});
 t.after(async()=>{if(receiver.exitCode===null){receiver.kill();await receiverDone;}});
 const app=await createApplication({directory:path.join(root,'app'),listen:false,clock:false,portableVault:true});t.after(()=>app.close());
 const {imported}=await app.studio.importMedia([video]);app.store.update(s=>s.settings.encoding={copy:true});
 const cid=app.studio.saveChannel({name:'Loopback receiver',url:`rtmp://127.0.0.1:${port}/live`,key:'LOCAL-ONLY'});
 await delay(300);assert.equal(receiver.exitCode,null,stderr);
 const [j]=await app.studio.start({mediaId:imported[0],channelIds:[cid],confirmed:true});const job=app.studio.jobs.get(j.id);
 await job.completion;await receiverDone;assert.equal(job.status,'completed',job.error);assert.ok(fs.existsSync(received),stderr);
 const mp4=path.join(root,'received.mp4');await runProcess('ffmpeg',['-v','error','-i',received,'-c','copy','-y',mp4]);const output=await probe(mp4,'ffprobe');
 assert.equal(output.width,320);assert.equal(output.height,180);assert.equal(output.fps,25);assert.equal(output.audio.codec,'aac');assert.ok(output.duration>=1.9);assert.ok(job.elapsed>=1.9);
});

test('remote MP4 relay feeds the real FFmpeg playlist without saving source copies',{timeout:30000},async t=>{
 const root=temp(t),source=path.join(root,'source.mp4');
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart','-y',source]);
 let requests=0;
 const app=await createApplication({directory:path.join(root,'app'),port:0,clock:false,portableVault:true,remoteOptions:{open:async(url,{range})=>{
   assert.equal(url,'https://cdn.example.test/clip.mp4');requests++;
   const size=fs.statSync(source).size,match=/^bytes=(\d*)-(\d*)$/.exec(range||'');let start=0,end=size-1;
   if(match){start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));if(match[1]&&match[2])end=Math.min(end,Number(match[2]));}
   const stream=fs.createReadStream(source,{start,end});stream.statusCode=match?206:200;stream.headers={'content-type':'video/mp4','content-length':String(end-start+1),'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${size}`}:{})};return stream;
 }}});t.after(()=>app.close());
 const {id}=await app.studio.importRemote({url:'https://cdn.example.test/clip.mp4'});
 const playlistId=app.studio.savePlaylist({name:'Remote clips',mediaIds:[id,id],loop:false});
 const [started]=await app.studio.start({playlistId,preview:true});const job=app.studio.jobs.get(started.id);await job.completion;assert.equal(job.status,'completed',job.error);
 const result=await probe(path.join(app.store.directory,'previews',job.output),'ffprobe');assert.ok(result.duration>=3.9);assert.ok(requests>=3);
 assert.ok(!fs.existsSync(path.join(app.store.directory,'downloads')));assert.ok(!fs.existsSync(path.join(app.store.directory,'converted')));assert.equal(app.store.data.media[0].size,0);
});


test('closing disconnects an unfinished authenticated HTTP upload without changing the project',{timeout:10000},async t=>{
 const root=temp(t),app=await createApplication({directory:root,port:0,clock:false,portableVault:true});t.after(()=>app.close());
 const address=new URL(app.base),socket=net.connect(Number(address.port),'127.0.0.1');socket.on('error',()=>{});t.after(()=>socket.destroy());
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
 let arrived;const seen=new Promise(resolve=>{arrived=resolve;});app.server.once('request',arrived);
 socket.write('POST /api/channels HTTP/1.1\r\nHost: '+address.host+'\r\nCookie: go_streams='+app.token+'\r\nContent-Type: application/json\r\nX-Go-Streams: 1\r\nContent-Length: 1000\r\n\r\n{');
 await seen;const before=JSON.stringify(app.store.data);const disconnected=new Promise(resolve=>socket.once('close',resolve));
 await app.close();await disconnected;assert.equal(JSON.stringify(app.store.data),before);assert.equal(app.server.listening,false);
});
