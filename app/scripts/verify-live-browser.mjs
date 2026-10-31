// Native Chromium test with synthetic camera/microphone and loopback-only RTMP.
// Uses the browser's debugging protocol; does not access a real camera or publish externally.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createApplication} from '../src/server.mjs';
import {toolsFor,runProcess} from '../src/core.mjs';

const candidates=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'];
const binary=process.env.GO_STREAMS_BROWSER||candidates.find(p=>fs.existsSync(p));
if(!binary)throw Error('Set GO_STREAMS_BROWSER to an installed Chromium browser.');
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'live-browser-'));
let app,browser,socket;const receivers=[],pagesErrors=[],chatPosts=[];let passed=false;
let phase='startup';
const watchdog=setTimeout(()=>{
 console.error(JSON.stringify({testTimedOut:true,phase,jobs:app?.studio.state().jobs,recordings:app?.recordings.state(),pageErrors:pagesErrors}));
 socket?.close();browser?.kill();for(const receiver of receivers)receiver.child.kill();for(const job of app?.studio.jobs.values()||[])job.child?.kill();process.exit(1);
},90000).unref();
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
try{
 app=await createApplication({directory:path.join(directory,'data'),port:0,portableVault:true,chatOptions:{request:async(url,options)=>{
  let value;if(url.includes('/videos?'))value={items:[{liveStreamingDetails:{activeLiveChatId:'mock-room'}}]};
  else if(options.method==='POST'){chatPosts.push(JSON.parse(options.body));value={id:'mock-reply'};}
  else value={pollingIntervalMillis:30000,nextPageToken:'mock-next',items:[{id:'mock-viewer',authorDetails:{displayName:'Test viewer',channelId:'viewer'},snippet:{displayMessage:'Hello <script>not executable</script>',publishedAt:new Date().toISOString()}}]};
  return new Response(JSON.stringify(value),{status:200});
 }}});
 app.studio.chat.auth.data.settings.YouTube={clientId:'123-test.apps.googleusercontent.com'};
 app.studio.chat.auth.data.accounts.YouTube={id:'host',name:'Test host',accessToken:'synthetic-test-token',expires:Date.now()+3600000};
 const {ffmpeg,ffprobe}=toolsFor(app.store.data.settings);
 for(let i=0;i<2;i++){
  const port=await freePort(),url=`rtmp://127.0.0.1:${port}/live`,key=`test-${i}`,output=path.join(directory,`destination-${i}.flv`);
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','warning','-listen','1','-timeout','30','-i',`${url}/${key}`,'-c','copy','-f','flv','-y',output],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-3000);});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve({code,stderr}));});
  receivers.push({child,done,output});app.studio.saveChannel({name:`Loopback ${i+1}`,platform:i===0?'YouTube':'Personalizado',url,key});
 }
 browser=spawn(binary,['--headless=new','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${path.join(directory,'browser')}`,'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{
  let buffer='';const timer=setTimeout(()=>reject(Error('Browser debugging endpoint did not open.')),20000);
  browser.once('error',reject);browser.once('exit',code=>reject(Error(`Browser exited before the test: ${code}`)));
  browser.stderr.on('data',chunk=>{buffer=(buffer+chunk).slice(-5000);const found=/DevTools listening on (ws:\/\/[^\s]+)/.exec(buffer);if(found){clearTimeout(timer);resolve(found[1]);}});
 });
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map();
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')pagesErrors.push(message.params.exceptionDetails.text+': '+(message.params.exceptionDetails.exception?.description||''));});
 const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Browser command timed out: ${method}`));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
 await command('Page.enable',{},sessionId);
 await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__captureTest=[];const NativeRecorder=window.MediaRecorder;window.MediaRecorder=class extends NativeRecorder{constructor(...args){super(...args);const stats={mime:this.mimeType,chunks:0,bytes:0,errors:[]};window.__captureTest.push(stats);this.addEventListener('dataavailable',e=>{stats.chunks++;stats.bytes+=e.data.size;});this.addEventListener('error',e=>stats.errors.push(String(e.error)));}};`},sessionId);
 await command('Page.navigate',{url:app.url+'#capture'},sessionId);
 await command('Runtime.enable',{},sessionId);
 const evaluate=async expression=>{
  const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result.value;
 };
 const waitFor=async(expression,timeout=20000)=>{const start=Date.now();while(!await evaluate(expression)){if(Date.now()-start>timeout)throw Error('Browser condition timed out: '+expression);await delay(100);}};
 await waitFor("Boolean(document.querySelector('[data-capture=preview]'))");
 await evaluate("document.querySelector('[data-capture=preview]').click()");
 await waitFor("Boolean(document.querySelector('.capture-preview').srcObject)");
 phase='preview-ready';console.log(JSON.stringify({phase}));
 assert.equal(await evaluate("document.querySelector('.capture-preview').srcObject.getVideoTracks().length"),1);
 assert.equal(app.studio.jobs.size,0,'Preview must not create a broadcast');
 await evaluate("const chat=document.querySelector('.chat-connect');chat.querySelector('[name=resource]').value='abcdefghijk';chat.querySelector('[name=confirmed]').checked=true;chat.querySelector('button').click();");
 await waitFor("document.querySelectorAll('.chat-message').length===1");
 assert.equal(await evaluate("document.querySelectorAll('.chat-messages script').length"),0);
 await evaluate("document.querySelector('.chat-message [data-chat=reply]').click();document.querySelector('.chat-compose textarea').value='Thank you';document.querySelector('.chat-compose button').click();");
 await waitFor("document.querySelectorAll('.chat-own').length===1");assert.equal(chatPosts.length,1);assert.equal(chatPosts[0].snippet.textMessageDetails.messageText,'@Test viewer Thank you');
 phase='chat-ready';console.log(JSON.stringify({phase}));
 await evaluate("const name=document.querySelector('.production-tools [name=name]');name.value='Test presenter';name.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-production=record]').click();");
 await waitFor("!document.querySelector('[data-production=stop-record]').disabled");
 phase='local-recording-started';console.log(JSON.stringify({phase}));
 await evaluate("document.querySelectorAll('.capture-destinations input').forEach(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});const consent=document.querySelector('[data-capture=consent]');consent.checked=true;consent.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-capture=start]').click();");
 phase='waiting-live-frames';console.log(JSON.stringify({phase}));
 const started=Date.now();while(![...app.studio.jobs.values()].filter(j=>j.status==='running').length||[...app.studio.jobs.values()].some(j=>j.frame<10)){
  if(Date.now()-started>30000){const diagnostics={jobs:app.studio.state().jobs,renderer:await evaluate('window.__captureTest'),pageErrors:pagesErrors,liveInputs:[...app.studio.liveCapture.sessions.values()].map(s=>({sequence:s.sequence,age:Date.now()-s.lastInput})),recordings:app.recordings.state()};throw Error('Live destinations did not receive frames: '+JSON.stringify(diagnostics));}await delay(200);
 }
 assert.equal(app.studio.jobs.size,2);
 assert.equal(await evaluate('window.__captureTest.length'),1,'Recording and live output must share one browser encoder');
 phase='live-frames-received';console.log(JSON.stringify({phase}));
 await evaluate("document.querySelector('[data-production=stop-record]').click()");
 await waitFor("document.querySelector('.recording-status').textContent.includes('saved locally')",30000);
 assert.ok([...app.studio.jobs.values()].every(j=>!j.ended),'Stopping recording must preserve live destinations');
 await evaluate("document.querySelector('[data-production=record]').click()");
 await waitFor("!document.querySelector('[data-production=stop-record]').disabled");await delay(4000);
 await evaluate("location.hash='live'");await waitFor("document.querySelectorAll('.job').length===2");
 assert.equal(await evaluate("document.querySelectorAll('[data-action=pause-job],[data-action=restart-job],[data-action=job-settings]').length"),0);
 await evaluate("location.hash='capture'");await waitFor("Boolean(document.querySelector('.capture-preview')?.srcObject)");
 await evaluate("document.querySelector('[data-capture=stop]').click()");
 await waitFor("!document.querySelector('[data-capture=release]').disabled");
 phase='live-stopped';console.log(JSON.stringify({phase}));
 await Promise.all([...app.studio.jobs.values()].map(j=>j.completion));
 assert.ok([...app.studio.jobs.values()].every(j=>j.status==='stopped'));
 assert.equal(app.recordings.active.size,1,'Stopping live destinations must not discard local recording');
 await evaluate("document.querySelector('[data-production=stop-record]').click()");
 await waitFor("document.querySelector('.recording-status').textContent.includes('saved locally')",30000);
 phase='recording-saved';console.log(JSON.stringify({phase}));
 assert.equal(app.recordings.state()[0].status,'completed');
 const localMedia=await runProcess(ffprobe,['-v','error','-show_format','-of','json',app.recordings.media(app.recordings.state()[0].id)]);
 assert.ok(Number(JSON.parse(localMedia.stdout).format.duration)>1);
 await evaluate("document.querySelector('[data-capture=release]').click()");await waitFor("!document.querySelector('.capture-preview').srcObject");
 for(const receiver of receivers){await receiver.done;const {stdout}=await runProcess(ffprobe,['-v','error','-show_streams','-of','json',receiver.output]);const streams=JSON.parse(stdout).streams;assert.equal(streams.find(s=>s.codec_type==='video').codec_name,'h264');assert.equal(streams.find(s=>s.codec_type==='audio').codec_name,'aac');}
 assert.deepEqual(pagesErrors,[]);passed=true;
 const proof={passed:true,platform:process.platform,syntheticCameraAndMicrophone:true,destinations:2,nativeRTMP:true,previewDoesNotBroadcast:true,previewSurvivesNavigation:true,stopAndRelease:true,localRecording:true,sharedCaptureEncoder:true,independentRecordStartStop:true,cloudRecording:false,unifiedChatWithSimulatedProvider:true,realChatAccountsVerified:false,realHardwareVerified:false,nativeScreenPickerVerified:false};
 const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;fs.mkdirSync('release',{recursive:true});fs.writeFileSync(`release/GoStreams-${version}-live-studio-${process.platform}-verification.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 await command('Browser.close').catch(()=>{});
}finally{
 phase='cleanup';
 socket?.close();if(browser&&browser.exitCode===null)browser.kill();
 await app?.close();for(const r of receivers)if(r.child.exitCode===null)r.child.kill();await Promise.allSettled(receivers.map(r=>r.done));
 if(!passed)console.error('Browser test evidence directory: '+directory);
 clearTimeout(watchdog);
}
